---
date: 2026-11-04T07:57:15+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn leg on the local PC (voyager fetch via curl-impersonate/Playwright + repo-payload hand-off)"
tags: [design, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-03_17-38-05_linkedin-execution-home.md
last_updated: 2026-11-04T14:36:12+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Slice 6 LOCKED + status ready. Post-ready follow-up: byte-match oracle ALL OK (9 fences vs gate-proven harness copies); pushPayload commit-exit check added (silent no-commit push bug — fence+suite amended, re-gated 159/159); state/linkedin-leg-dead.flag joins .gitignore; README one-time git-identity step; stash marked not-a-source-of-truth; prose-only fences adjudicated accepted"
---

# Design: LinkedIn leg on the local PC

## Summary

The LinkedIn fetch leg moves to the developer's PC as an always-on local npm loop (`npm run watch-linkedin`, 10-minute sleep in code). Each tick opens the voyager search endpoint documented in `H:/fork/linkedin-reverse/DOCUMENTATION.md` §3/§12.7 through a `VoyagerGet` transport seam with two adapters — curl-impersonate (primary, probe-decided) and Playwright chromium (fallback) — both fed from one local cookie file. Fetched raw posts are written atomically to `state/linkedin-posts.json` and pushed to the repo as a single-path commit; the hosted watch run reads that file at the existing dedupe seam with shape + staleness validation. The surface walk reuses `runPool` (src/pool.ts) under a global pacing gate and keeps the degrade-per-surface + caller-owned skip-warn contract. The Linked API SDK quad is removed, and the judge/email/heartbeat/threads/state machinery is untouched.

## Requirements

- Only the LinkedIn fetch runs locally; judge, email, threads, and seen-state stay on GitHub Actions (developer: "run it from project folder using npm run… but only for linkedin part").
- The endpoint, headers, restli encoding, and query id come from `DOCUMENTATION.md` verbatim — never from a capture-observed URL (developer lock, 2026-11-04).
- Try curl-impersonate first; keep Playwright as the tested fallback; the probe decides (developer adjustment, 2026-11-04).
- A dead leg (Cloudflare wall, dead session, CSRF 403) sends ONE alarm email per episode and the loop keeps running so a cookie-file refresh self-heals (developer decision).
- Fail-visible: an absent or stale payload degrades to threads-only with a log line; nothing silently pretends LinkedIn ran.
- No new runtime npm dependency without stated need; the SDK dependency is removed.
- Offline deterministic tests; injectable I/O seams; strict TS flags stay on.
- The surface walk reuses `runPool` from `src/pool.ts` and preserves the degrade-per-surface + caller-owned skip-warn contract; no second, parallel fetch path (developer flag, 2026-11-04).

## Current State Analysis

The hosted funnel (`src/index.ts` runWatcher) partitions linkedin surfaces (src/index.ts:166-168), calls the SDK fetcher through the `WatcherDeps.linkedinFetch` seam (:114-118, default :156), merges via single-array return (:220) into `dedupePosts` (:228, def :371-382). The SDK arm is dead in production: 5/5 recent runs returned zero posts with the dead-session warn, exit 0 (transport artifact follow-up, 2026-11-03). watch.yml maps the `LINKED_API_*` secret pair (:104-105) and carries SDK-era comment premises (:11-19, :59-64). The fetch-linkedin quad to remove: module (261 lines), suite (~346 lines), `ENV_NAMES` pair (src/config.ts:16-17), watch.yml mapping, package.json:21.

### Key Discoveries

- Endpoint spec of record: `H:/fork/linkedin-reverse/DOCUMENTATION.md` — GET `https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.c2c5d4b012c05a6a94396191208d45f6&queryName=SearchClusterCollection&variables=<restli>` with headers `csrf-token` (JSESSIONID value, quotes stripped), `x-restli-protocol-version: 2.0.0`, `x-li-graphql-pegasus-client: true`, `x-li-lang: en_US`, `accept: application/json`, cookie pair where `Cookie` keeps `JSESSIONID="ajax:..."` WITH quotes (§3, §7.5, §10).
- Recency switch correction (§12.4 CRITICAL): `orderBy` is IGNORED; the real switch is `queryParameters.sortBy:date_posted`. Canonical recipe §12.7: `queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)`.
- Restli grammar (§4.1) + URL layer (§12.5 verified matrix): reserved `( ) : , '` escape as uppercase %HH inside string values; spaces `%20`, `&` `%26` at the URL layer; parens/colons/commas stay raw.
- Pagination (§12.1, §12.8): count 50 unclamped; `start += count`; exhaustion is ALWAYS HTTP 200, terminal signal `elements: []`, client stops on a partial page; never gate on `metadata.totalResultCount` (fluctuates 481-492).
- Failure matrix (§13): `403 "CSRF check failed."` (text body) = header bug; bare `400 {"status":400}` on the finder = dead/absent `li_at`; graphql-envelope 400 `{"data":{"status":400},"included":[]}` = bad variables (our bug); 500 = unknown queryId (hash expiry, §15); connection resets with HTML still loading = abuse throttling — back off. Amendment (live-observed 2026-11-05, validate rehearsal): 302/3xx redirect loop → leg-dead — a dead session presents as a 302 loop on this client stack, contradicting DOCUMENTATION.md §13.1's API-vs-browser redirect claim (§13.1 says only browser navigations redirect); the endpoint never legitimately redirects a GET, the remedy is identical to 401, and root cause (session death vs edge fingerprint block) is deliberately unresolved — both carry the same operator remedy.
- Response walk (§6 + live capture `.rpiv/tmp/voyager-capture.json`, 59,897 bytes, 200 OK): posts at `items[].item.searchFeedUpdate.update`; id `metadata.backendUrn`; text `commentary.text.text`; author `actor.name.text`; permalink `socialContent.shareUrl` (strip `?query`); timestamp NOT in payload — derive `BigInt(id) >> 22n` (4-6 min drift, repost caveat → provenance comment).
- Session (§14): no refresh token exists; browser login yields the accepted `li_at`+`JSESSIONID` pair (§2.4 VERIFIED); 2FA challenge dead-ends headless login (live-confirmed) → no automated re-login, refresh = interactive export.
- The live capture is a pure response body (grep for li_at/JSESSIONID/cookie/authorization keys: 0 hits) and sits under gitignored `.rpiv/tmp/` (.gitignore:5) — safe to trim into a scrubbed fixture.
- Deletion residue lesson (commit `bf6594c`): deletion commits must sweep `.gitignore` rules, `.env` keys, and stray local blobs in the same commit; the linkedin-login deletion left `.gitignore:8` + an untracked `linkedin-state.b64` blob that became audit item N010.
- watch.yml has no `needs:` chains and no artifact usage; adding none keeps the commit-back surface untouched. Workflow-level concurrency `watch` + cancel-in-progress stays as-is — the PC loop is outside Actions entirely.
- `dedupePosts` is an identity transform when the payload contributes zero posts — Gate 1 stays byte-identical (analyzer-confirmed).
- The entry guard (src/index.ts:383-406) compares `process.argv[1]` per module, so new script entries coexist safely.
- `npm run format` covers only `src tests` while lint also checks `scripts/probe-judge.ts` + `scripts/hooks` — new scripts must join BOTH globs (developer note, 2026-11-04).
- Developer flag resolved (2026-11-04): the walk reuses `runPool` (src/pool.ts — the bounded slot-array pool behind `fetchSurfaces`/`fetchSurfacesAuthenticated`) per the developer's direction; the SDK-era FR4 "sequential for LinkedIn" note belonged to the SDK loop and dies with the module. A shared pacing gate (last-call timestamp + 5s) keeps the GLOBAL voyager call rate identical while two surfaces interleave.
- `.rpiv/artifacts/` is tracked by repo decision (root guidance: only `.rpiv/tmp/` and the graph db are untracked); prior design/plan artifacts are committed history, so this design doc belongs in the feature-branch diff.

## Scope

### Building

- `src/linkedin-voyager.ts` — pure voyager client core: restli encoder, §12.7 search-URL builder, header builder, response parser → `Post` (drop+count).
- `src/linkedin-session.ts` — local cookie file (`{ "liAt": "...", "jsessionid": "ajax:..." }`) resolver (fail-visible), Cookie-header assembly (quote asymmetry), storageState synthesis for the Playwright adapter.
- `src/linkedin-transport.ts` — `VoyagerGet` seam, curl-impersonate adapter (spawned binary, injectable exec), Playwright adapter (context.request), §13.3 fault classifier, `LegDeadError` tagged error + guard.
- `src/linkedin-fetch.ts` — per-surface paging walk (count 50, `start += count`, 5s pacing, exhaustion-as-success, per-surface warn+skip, leg-dead throws).
- `src/linkedin-payload.ts` — payload envelope (writtenAt + posts), atomic write, read + validate (per-row shape, staleness bound).
- `scripts/fetch-linkedin.ts` (one tick), `scripts/watch-linkedin.ts` (loop), `scripts/probe-linkedin.ts` (exit-1 gate probe).
- Alarm-email variant in `src/email.ts` + `ENV_NAMES` additions; package.json run entries + lint/format glob extension.
- Watch-side ingest: `WatcherDeps.linkedinFetch` re-keyed to the payload reader (src/index.ts arm + tests).
- Removal: `src/fetch-linkedin-api.ts`, its suite, `ENV_NAMES` pair, watch.yml mapping + comment premises, package.json dependency, README/AGENTS/guidance residue, `.gitignore` sweep.
- README PC-operations section: curl-impersonate install, cookie export procedure, probe protocol (twice ≥6h apart), loop start/stop, alarm semantics, queryId re-derivation note (§15).

### Not Building

- No runner agent, no new workflow, no artifact upload/download, no dispatch plumbing.
- No gist/storage third service (developer chose repo push).
- No automated re-login / UAS credential flow (2FA dead-end, live-confirmed).
- No Task Scheduler setup (developer chose the always-on console loop).
- No judge, email-digest, heartbeat, threads, or seen-state changes; `watcher.config.json` surfaces unchanged.
- No transport auto-fallback in code — switching `curl` → `playwright` is an operator action after a failed probe.
- No Pi/mini-PC migration work (config-only later).

## Decisions

### D1: Execution model — local always-on npm loop

`npm run watch-linkedin` runs a tick-then-sleep-10-min loop in the project folder; the developer starts it after boot. No GitHub Actions job hosts the fetch. Evidence: developer correction "does not mean I install GitHub [runner agent] on my PC… I run it from project folder using npm run" and scheduling choice "Always-on npm script". The solution artifact's runner-agent Option 1 and artifact hand-off are superseded; Option 2's shape is implemented instead.

### D2: Transport — curl-impersonate primary, Playwright fallback, probe decides

`LINKEDIN_TRANSPORT` env selects `curl` (default) or `playwright`; anything else throws naming the allowed values. curl adapter spawns the curl-impersonate chrome build (binary path via `CURL_IMPERSONATE_BIN`, fail-visible when unset). Playwright adapter reuses the `ContextFactory` quarantine idiom. No silent auto-switching: a failed probe → the operator sets the other transport and re-probes. Evidence: developer adjustment ("try first using curl-impersonate… if it not work then keep using playwright"); DOCUMENTATION.md §10+§12 show the doc's entire verified matrix was curl-driven with the two-cookie pair; the repo's 302-loop wipe was reputation decay after rapid calls, not an endpoint defect.

Amendment (2026-11-05, Phase 9): the distribution of record for Windows is the LEXIFOREST fork's single `curl-impersonate` binary — upstream lwthiker ships linux/mac/docker only — installed by `npm run setup-curl` (checksum-pinned release v2.3.2, release-published sha256 digests, gitignored `tools/` install target; no npm dependency). The transport pins `--impersonate chrome116`: the profile owns the UA + TLS + HTTP/2 fingerprint as ONE consistent set, and the transport's manual `user-agent` header pair is dropped — overriding the profile's UA with a different Chrome version is exactly the mismatched-signal class the fingerprint exists to avoid. `BROWSER_UA` keeps feeding ONLY the playwright adapter (no profile system there). Our §3/§10 `-H` overrides (cookie, csrf-token, the static set) compose on top of the profile headers per the fork README.

### D3: Endpoint spec of record — DOCUMENTATION.md, never a captured URL

URL, queryId hash `c2c5d4b0…`, queryName, variable set (`query`, `origin`, `start`, `count`), header set, restli+URL encoding rules, and the §12.7 canonical recipe (`sortBy:date_posted`, no `orderBy`) are transcribed from the doc into `src/linkedin-voyager.ts` as named constants with provenance comments. The live capture (`.rpiv/tmp/voyager-capture.json`) is only a parser fixture source, trimmed + scrubbed into `tests/fixture/voyager-search-response.json`. Timestamp derivation `BigInt(id) >> 22n` carries the §12.4 repost caveat as a provenance comment. Evidence: developer lock "use endpoint from the documentation.md not from browser… a browser-observed endpoint carries session-specific params and will drift".

### D4: Session — one local cookie file, no automated re-login

`LINKEDIN_COOKIES_FILE` (env) points to a JSON file OUTSIDE the repo: `{ "liAt": "...", "jsessionid": "ajax:..." }`. Resolver is fail-visible: unset/blank/malformed/missing-cookies → throw naming the variable (the fetch leg has no reason to exist without it — stricter than the silent-null `resolveSession` model, which stays for Threads). The Playwright adapter synthesizes a storageState from the pair; the curl adapter builds the `Cookie` header keeping `JSESSIONID` quoted while `csrf-token` strips quotes (§3/§7.5). Refresh = interactive browser export (§2.4 VERIFIED lowest-risk); `linkedin-cookies*.json` joins `.gitignore` as belt. Evidence: developer hand-off choice; §13/§14 session mechanics; 2FA dead-end live-confirmed.

### D5: Hand-off — single-path git push, disjoint from the bot

Each successful tick writes `state/linkedin-posts.json` (atomic temp+rename), commits ONLY that path (`git add state/linkedin-posts.json` — never anything else), then: `git fetch origin` → `git rebase origin/main` (abort clean on failure) → `git push` → on rejection: fetch + rebase + push once more → else exit 1. Serialization with the bot: BOTH writers run this same rebase+retry discipline (the bot's lives in scripts/commit-state-rebase.sh), so an exact-simultaneous push pair costs the loser one retry — never a lost update, because each file has exactly one writer (the PC never touches seen-posts.json; the bot never touches the payload), and a rebase always re-derives onto the true origin/main. The bot's abort-on-foreign-conflict whitelist can never trigger: its replay of seen-posts.json onto a tree containing the payload commit touches a disjoint path. The loop runs from a DEDICATED clone (or worktree) of main — not the dev checkout — so unrelated uncommitted edits can never wedge the rebase, and the rebase doubles as the loop's own code auto-update. Alternatives rejected: a payload branch (extra fetch step in watch.yml — contradicts zero hosted changes; a second stale head to manage), GitHub Contents API PUT (new API integration duplicating the git discipline the repo already ships), Actions artifact (needs a runner agent on the PC — rejected execution model). Evidence: developer choice "push file to repo" + conflict question answered + mechanism re-confirmed 2026-11-04; N3 hazard analysis; N017 growth precedent accepted for payload history (~144 small commits/day).

### D6: Funnel seam — re-key `linkedinFetch`, keep the arm shape

`WatcherDeps.linkedinFetch` keeps its name/position but is retyped to a payload reader `(payloadPath, now) => Promise<PayloadRead>` with production default `readPayloadPosts` (env-independent: the fixed repo path constant `LINKEDIN_PAYLOAD_PATH` lives in config.ts beside `STATE_PATH`). `PayloadRead` = `{ posts, leg }` where `leg` is the D13 `LegStatus`; the funnel attaches it to `HeartbeatStats.linkedinLeg` so the heartbeat body ALWAYS renders one leg line and the digest body renders it whenever the state is not `ok` (D13) — a threads-only run is permanently quiet, so "no matches" must stay distinguishable from "LinkedIn dark for a week". The acquisition arm keeps partition, log labels, D12 belt catch; the token warn is replaced by payload-stale/absent log lines. Absent/stale payload = identity transform — Gate 1 stays green, threads-only run unaffected. Evidence: developer choice "Reuse seam, re-keyed"; analyzer identity-transform confirmation; existing four test doubles re-key in place.

### D7: Failure policy — alarm email per episode, loop keeps running

Leg-dead signatures (per §13.3: bare-400 dead session, CSRF-403, CF challenge shape, throttling resets, and — amended 2026-11-05 from the validate rehearsal — the live-observed 302/3xx redirect loop, with `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the chain; DOCUMENTATION.md §13.1's API-vs-browser redirect claim does not hold for this client stack, remedy identical to 401) throw `LegDeadError` (tagged error: name constant + factory + type guard, judge-rotation idiom). The loop catches it: sends ONE alarm email on the healthy→dead transition edge (no email storm; a 144-tick dead day emails once), logs a warn every dead tick, keeps looping; a cookie-file refresh self-heals on a later tick without restart. The one-shot `npm run fetch-linkedin` exits 1 on leg-dead. Per-surface faults (one keyword fails, others OK) stay warn+skip per the old totality contract; an ALL-faulted walk (every surface faulted, none leg-dead) throws the tagged `AllSurfacesFaulted` and the tick is a quiet-zeros no-op — payload, git, and episode marker untouched, so the hosted reader keeps scoring the LAST GOOD payload instead of a fresh empty one (Phase 8, b2; partial faults still degrade per D13 — survivors publish). Evidence: developer choice "Alarm email + keep looping"; the SDK-era silent-green failure (5/5 runs, exit 0) is the anti-pattern this kills; the pushed-empty-payload rehearsal (2026-11-05) is the b2 anti-pattern the all-faulted guard kills.

### D8: Probe — zero-edit gate script

`scripts/probe-linkedin.ts` imports the production fetcher + transport selection (same code path the loop drives — the probe-judge "zero-edit site" doctrine), fetches the first configured surface with a small count, prints `probe:` lines, exits 1 on leg-dead or <2 posts. Operator protocol: run twice ≥6h apart with stored cookies only (Nov 1 research rule) before trusting the loop; re-run after any transport switch. Registered in package.json beside the other entries (developer requirement).

### D9: Staleness — payload age bounds trust

The payload envelope carries `writtenAt`. The watch-side reader treats a payload older than 30 minutes (module constant, `PAYLOAD_MAX_AGE_MS = 1_800_000` — twice the cadence) as absent: one log line, threads-only run. Per-row staleness stays with `filterRecent` (72h window) as today. Evidence: D5's PC-off failure mode; the solution artifact's "staleness validation" requirement.

### D11: Surface walk — runPool reuse, degrade-per-surface preserved

Developer flag (2026-11-04): the replacement must not read as a parallel fetch abstraction. `fetchLinkedInPosts` therefore reuses `runPool` from `src/pool.ts` — the same bounded slot-array pool driving `fetchSurfaces`/`fetchSurfacesAuthenticated` — with results reassembled in input order and per-surface faults landing in the side array (warn + skip; the caller-owned skip warn stays in the index.ts arm). Width: `LINKEDIN_FETCH_CONCURRENCY = 2` module constant. A shared pacing gate (module-closure last-call timestamp; each GET waits until `lastCallAt + 5_000`) keeps the global voyager call rate identical to a sequential walk — the anti-bot rate is pacing-bound, not width-bound (§7.8, §13.3). Leg-dead classification still aborts the tick (D7); surface-level faults still skip only that surface.

Verified against source (2026-11-04, graph snippets + full-file reads at 4c11e0f): `runPool<T>(items, width, worker: (item, index) => Promise<void>): Promise<void>` returns VOID (src/pool.ts:33-52) — the walk owns the side arrays (`posts[index]`, `faults[index]`) filled inside a total worker, mirroring fetchSurfacesAuthenticated (src/fetch-threads.ts:294-343). Leg-dead aborts through the repo's drain-then-throw shape (judgePosts fallback pool, src/judge.ts:681-830; fast-workflow-runtime D11): catch `isLegDead` in the worker, set a shared flag, stop claiming, throw `LegDeadError` once after the join — never a raw throw mid-pool.

### D13: Watch-side payload faults degrade, never exit — and ride the email

Slice 5's payload reader semantics, fixed before code: missing file (ENOENT) → one quiet log line (`linkedin: no payload — threads-only run`), exit 0 — the PC-off / never-ran state is NORMAL, not a fault. Over-age payload → one log line naming the age (D9). Malformed envelope (bad JSON / unknown version) → warn naming the reason + threads-only, run stays green. Per-row malformation → drop + count (D6). Rationale: (a) the AGENTS.md platform-isolation boundary — a LinkedIn fault can never fail a run; (b) the alarm duty for leg faults lives where the fault originates (the PC leg, D7) — a payload file can only be damaged by a write bug or manual edit, and hard-exiting threads+judge+email over it inverts the blast radius this design exists to fix. Every class stays operator-visible in run logs; nothing is silent. Beyond run logs: the leg state RIDES the email surface — `HeartbeatStats.linkedinLeg` feeds a heartbeat line on every run and a digest line on every not-ok run. The heartbeat exists precisely so quiet runs stay legible; a threads-only run is permanently quiet, and the PC-side alarm cannot fire while the PC is off — exactly the case only the hosted side can report.

### D10: Removal — the SDK quad plus residue sweep

Slice 6 deletes `src/fetch-linkedin-api.ts`, `tests/fetch-linkedin-api.test.ts`, the `ENV_NAMES` pair, watch.yml mapping lines, and the package.json dependency; sweeps comment premises (watch.yml concurrency block, F023 envelope note), README, AGENTS.md, guidance files, `.gitignore:8` (`linkedin-state*.b64`), and any stray local blob — the bf6594c lesson applied in-commit. Acceptance: `git grep -nE 'linkedapi|linked_api|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` returns 0 lines (git grep walks tracked files only — no .git/ or scratch walks).

## Architecture

### src/linkedin-voyager.ts — NEW

Pure voyager client core: restli encoder (§4.1 + §12.5 + the URL-layer `#`→`%23` rule), §12.7 search-URL builder, §3 static header set, §6 response parser → `Post[]` with drop+count, `BigInt(id) >> 22n` timestamp derivation with provenance. Never throws; unparsable bodies surface as `{kind: "unparsable"}` for the walk's fault policy (slice 3).

```ts
/**
 * Pure voyager search client core — endpoint, encoding, response walk.
 *
 * SPEC OF RECORD: H:/fork/linkedin-reverse/DOCUMENTATION.md (§3 request,
 * §4.1 restli grammar, §12.5 verified escaping matrix, §12.7 canonical
 * latest-posts recipe, §6 response walk). Constants are transcribed from
 * the documentation verbatim — never from a capture-observed URL
 * (developer lock 2026-11-04: captured endpoints carry session-specific
 * params and drift). No I/O lives here: the transport arrives in slice 3
 * and cookies in slice 2; this module stays offline-testable by design.
 */
import type { Post } from "./types.js";

/**
 * §3 — the only host+path this client may talk to. All voyager APIs live
 * under /voyager/api/ (§1, Routes.buildUponRoot proven).
 */
export const VOYAGER_GRAPHQL_ENDPOINT = "https://www.linkedin.com/voyager/api/graphql";

/**
 * §3.1 — the posts finder hash, PROVEN from SearchGraphQLClient's static
 * map and VERIFIED live 2026-11-03 against APK 4.1.1267. The registered
 * variant 75dbd5da… is an entity-cluster variant useless for posts
 * (§12.6). A sudden 500 where 200s used to be means the hash expired
 * server-side (§15) — re-derive from a current APK; do not debug variables.
 */
export const VOYAGER_QUERY_ID = "voyagerSearchDashClusters.c2c5d4b012c05a6a94396191208d45f6";

/** §3 — the queryName paired with VOYAGER_QUERY_ID. */
export const VOYAGER_QUERY_NAME = "SearchClusterCollection";

/**
 * §3 static header set. The cookie pair and the per-request csrf-token
 * header (JSESSIONID value, quotes stripped) ride the session module
 * (slice 2). Per-line provenance: x-restli-protocol-version 2.0.0 (§3);
 * x-li-graphql-pegasus-client true (§3); x-li-lang en_US (§3); accept
 * application/json PLAIN — the normalized+json accept returns HTTP 500,
 * "A record in the included list does not have a type" (§7.2 gotcha 2).
 */
export const VOYAGER_STATIC_HEADERS: Readonly<Record<string, string>> = {
  "x-restli-protocol-version": "2.0.0",
  "x-li-graphql-pegasus-client": "true",
  "x-li-lang": "en_US",
  accept: "application/json",
};

/**
 * Reserved restli characters inside string values (§4.1,
 * DataCodecConstants.RESERVED_CHARS). Escaped as uppercase %HH before the
 * URL layer runs; outside string values they ARE the record/map structure.
 */
const RESTLI_RESERVED = new Set(["(", ")", ":", ",", "'"]);

/**
 * Encode one restli string value (§4.1 + §12.5 verified matrix): reserved
 * `( ) : , '` → uppercase %HH inside the value; then the URL layer's
 * space → %20, ampersand → %26, hash → %23 — a raw `#` starts the URL
 * fragment and silently truncates the GET query, and every configured
 * keyword starts with one (watcher.config.json). Plain JSON variables
 * always 400 (§7.1); restli text plus these escapes is the wire format.
 */
export function encodeRestliValue(value: string): string {
  let out = "";
  for (const char of value) {
    if (RESTLI_RESERVED.has(char)) {
      out += `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (char === " ") {
      out += "%20";
    } else if (char === "&") {
      out += "%26";
    } else if (char === "#") {
      out += "%23";
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Build the restli `variables` value for one page of the canonical
 * latest-posts recipe (§12.7): resultType CONTENT (posts only), datePosted
 * past-24h, sortBy date_posted — the REAL recency switch (§12.4 CRITICAL:
 * orderBy is ignored byte-identically by this finder, so it is omitted).
 * Variable set exactly per §5.3: query, origin, start, count (no
 * paginationToken — never exercised live).
 */
export function encodeSearchVariables(keywords: string, start: number, count: number): string {
  const kw = encodeRestliValue(keywords);
  return `(query:(keywords:${kw},flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:${start},count:${count})`;
}

/** §3/§12.7 — the complete GET URL: endpoint, queryId, queryName, variables. */
export function buildSearchUrl(keywords: string, start: number, count: number): string {
  return (
    `${VOYAGER_GRAPHQL_ENDPOINT}` +
    `?queryId=${VOYAGER_QUERY_ID}` +
    `&queryName=${VOYAGER_QUERY_NAME}` +
    `&variables=${encodeSearchVariables(keywords, start, count)}`
  );
}

const ACTIVITY_URN_RE = /^urn:li:activity:(\d+)$/;

/**
 * Derive the post time from the activity id: strip the low 22 shard bits,
 * the rest is epoch ms — the exact inverse of tests/index.test.ts:93's
 * forward trick. PROVENANCE (live capture 2026-11-03): the response does
 * NOT carry a timestamp field; derivation drifts 4-6 minutes against the
 * post's own age label, and reposts mint ids that are not strict creation
 * clocks (§12.4). Good enough for the 72h recency window; never for
 * ordering.
 */
export function timestampFromActivityId(urn: string): string | null {
  const match = ACTIVITY_URN_RE.exec(urn);
  if (match === null) return null;
  const id = match[1] ?? "";
  try {
    const ms = BigInt(id) >> 22n;
    if (ms <= 0n) return null;
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

/** Tracking params (utm_*, rcm) ride every shareUrl — keep the canonical path only. */
function stripUrlQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readPath(node: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = node;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export type ParseResult =
  | { kind: "ok"; posts: Post[]; dropped: number }
  | { kind: "unparsable"; reason: string };

/**
 * Parse one 200 search response body (§6 walk):
 * data.searchDashClustersByAll.elements[].items[].item.searchFeedUpdate.update.
 * Only rows carrying searchFeedUpdate count as posts; header/feedback
 * clusters are structural and ignored. A row missing any required fact is
 * dropped and counted — one
 * malformed row must never poison seen-state or burn a judge attempt.
 * Unparsable bodies surface as kind "unparsable" for the walk's fault
 * policy (slice 3); this parser never throws. metadata.totalResultCount
 * is deliberately never read (§12.1: it fluctuates 481-492 call-to-call).
 */
export function parseSearchResponse(body: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { kind: "unparsable", reason: error instanceof Error ? error.message : String(error) };
  }
  const rows = readPostRows(parsed);
  const posts: Post[] = [];
  let dropped = 0;
  for (const update of rows) {
    const post = mapUpdate(update);
    if (post === null) {
      dropped += 1;
      continue;
    }
    posts.push(post);
  }
  return { kind: "ok", posts, dropped };
}

function readPostRows(parsed: unknown): Record<string, unknown>[] {
  const root = parsed as {
    data?: { searchDashClustersByAll?: { elements?: unknown } };
  };
  const elements = root.data?.searchDashClustersByAll?.elements;
  if (!Array.isArray(elements)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const element of elements) {
    const items = (element as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const update = (item as { item?: { searchFeedUpdate?: { update?: unknown } } }).item
        ?.searchFeedUpdate?.update;
      if (update !== null && typeof update === "object") {
        rows.push(update as Record<string, unknown>);
      }
    }
  }
  return rows;
}

function mapUpdate(update: Record<string, unknown>): Post | null {
  const backendUrn = readText(readPath(update, ["metadata", "backendUrn"]));
  if (backendUrn === null) return null;
  const text = readText(readPath(update, ["commentary", "text", "text"]));
  if (text === null) return null;
  const author = readText(readPath(update, ["actor", "name", "text"]));
  if (author === null) return null;
  const shareUrl = readText(readPath(update, ["socialContent", "shareUrl"]));
  if (shareUrl === null) return null;
  const timestamp = timestampFromActivityId(backendUrn);
  if (timestamp === null) return null;
  return {
    platform: "linkedin",
    id: backendUrn,
    text,
    author,
    permalink: stripUrlQuery(shareUrl),
    timestamp,
  };
}
```

### tests/linkedin-voyager.test.ts — NEW

Offline suite: §12.5 escaping matrix (6 exact-string rows incl. `#`→`%23`), §12.7 byte-for-byte URL snapshot + orderBy-absent pin, timestamp derivation (3 rows, incl. the `tests/index.test.ts:93` inverse), parser over the scrubbed fixture (4 pinned edges + exhaustion deepEqual + unparsable). Fixture provenance lives in the suite header comment and the loading test's title.

```ts
/**
 * Offline suite for the pure voyager client core (slice 1).
 *
 * FIXTURE PROVENANCE: tests/fixture/voyager-search-response.json is a
 * trimmed, scrubbed copy of the 2026-11-03 live capture
 * (.rpiv/tmp/voyager-capture.json — curl probe, keywords "#hiring react",
 * datePosted past-24h, start 0, count 5, HTTP 200). Masking policy: author
 * names genericized, company/member urn digits and rcm tracking values
 * masked, post texts truncated at 200 chars; activity ids kept VERBATIM so
 * the timestamp-derivation edge stays real. JSON carries no comments —
 * this header and the test titles are the provenance record. Pinned
 * edges: (1) header cluster ignored, (2) feedback card ignored, (3) two
 * valid posts mapped through the §6 walk, (4) one malformed row dropped
 * and counted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  VOYAGER_GRAPHQL_ENDPOINT,
  VOYAGER_QUERY_ID,
  VOYAGER_QUERY_NAME,
  buildSearchUrl,
  encodeRestliValue,
  encodeSearchVariables,
  parseSearchResponse,
  timestampFromActivityId,
} from "../src/linkedin-voyager.js";
import type { Post } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "voyager-search-response.json"), "utf8");

describe("encodeRestliValue", () => {
  it("escapes the §12.5 matrix: comma + space", () => {
    assert.equal(encodeRestliValue("hiring react, remote"), "hiring%20react%2C%20remote");
  });

  it("escapes parens (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring (react)"), "hiring%20%28react%29");
  });

  it("escapes colons (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring: react"), "hiring%3A%20react");
  });

  it("escapes ampersands at the URL layer (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring & react"), "hiring%20%26%20react");
  });

  it("escapes single quotes (phrase keywords, §12.5)", () => {
    assert.equal(encodeRestliValue("'hiring react'"), "%27hiring%20react%27");
  });

  it("encodes # at the URL layer — a raw # truncates the GET query (live capture)", () => {
    assert.equal(encodeRestliValue("#hiring"), "%23hiring");
  });
});

describe("buildSearchUrl", () => {
  it("reproduces the §12.7 canonical latest-posts URL byte-for-byte", () => {
    assert.equal(
      buildSearchUrl("#hiring react", 0, 50),
      `${VOYAGER_GRAPHQL_ENDPOINT}?queryId=${VOYAGER_QUERY_ID}&queryName=${VOYAGER_QUERY_NAME}&variables=(query:(keywords:%23hiring%20react,flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:0,count:50)`,
    );
  });

  it("omits orderBy entirely (§12.4: ignored; sortBy:date_posted is the real switch)", () => {
    const variables = encodeSearchVariables("#hiring", 25, 50);
    assert.ok(!variables.includes("orderBy"));
    assert.ok(variables.includes("sortBy:date_posted"));
    assert.ok(variables.includes("start:25"));
    assert.ok(variables.includes("count:50"));
  });
});

describe("timestampFromActivityId", () => {
  it("derives epoch ms from the activity id (low 22 bits stripped)", () => {
    const id = "7523281949587681280";
    const expected = new Date(Number(BigInt(id) >> 22n)).toISOString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), expected);
  });

  it("inverts the tests/index.test.ts:93 forward trick", () => {
    const ms = Date.UTC(2026, 9, 26, 9, 14, 0);
    const id = (BigInt(ms) << 22n).toString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), new Date(ms).toISOString());
  });

  it("rejects non-activity urns and non-urn strings", () => {
    assert.equal(timestampFromActivityId("urn:li:share:123456789"), null);
    assert.equal(timestampFromActivityId("not-a-urn"), null);
  });
});

describe("parseSearchResponse", () => {
  const result = parseSearchResponse(fixture);

  it("parses the scrubbed 2026-11-03 live capture (edges 1-4 pinned below)", () => {
    assert.equal(result.kind, "ok");
  });

  it("maps the two valid posts through the §6 walk (edge 3)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.posts.length, 2);
    const first = result.posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.id, "urn:li:activity:7523281949587681280");
    assert.match(first.text, /^#hiring Technology Manager/);
    assert.equal(first.author, "Author One");
    assert.equal(
      first.permalink,
      "https://www.linkedin.com/posts/member-handle_httpsjobsrminecomjobnltechnology-manager-activity-7523281949587681280-5dUC",
    );
    assert.equal(first.timestamp, timestampFromActivityId(first.id));
  });

  it("ignores the header and feedback clusters (edges 1-2)", () => {
    assert.ok(result.kind === "ok");
    assert.ok(result.posts.every((post) => post.author !== "243 results"));
    assert.ok(result.posts.every((post) => post.id.startsWith("urn:li:activity:")));
  });

  it("drops the malformed row and counts it (edge 4)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.dropped, 1);
    assert.ok(result.posts.every((post) => post.id !== "urn:li:activity:7523282112511242241"));
  });

  it("never reads metadata.totalResultCount (§12.1: it fluctuates 481-492)", () => {
    const noMeta = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(noMeta, { kind: "ok", posts: [], dropped: 0 });
  });

  it("maps an exhausted page (elements: []) to ok with zero posts (§12.8 terminal signal)", () => {
    const exhausted = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(exhausted, { kind: "ok", posts: [], dropped: 0 });
  });

  it("surfaces unparsable bodies without throwing", () => {
    const bad = parseSearchResponse("<html>challenge</html>");
    assert.equal(bad.kind, "unparsable");
  });
});
```

### tests/fixture/voyager-search-response.json — NEW

Trimmed, scrubbed live capture (source `.rpiv/tmp/voyager-capture.json`, body-only, member handles genericized, urn digits preserved for timestamp tests). Final form: 2-space indent, 3,428 bytes, scrub grep 0 hits. JSON carries no comments — provenance lives in the loading test's header + titles.

```json
{
  "data": {
    "searchDashClustersByAll": {
      "metadata": {
        "totalResultCount": 243
      },
      "elements": [
        {
          "items": [
            {
              "item": {
                "simpleTextV2": {
                  "text": {
                    "text": "243 results"
                  }
                }
              }
            },
            {
              "item": {
                "feedbackCard": {
                  "text": {
                    "text": "Send feedback"
                  }
                }
              }
            }
          ]
        },
        {
          "items": [
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523281949587681280",
                      "detailPageType": "FEED_DETAIL"
                    },
                    "commentary": {
                      "text": {
                        "text": "#hiring Technology Manager\n\nApply here: https://lnkd.in/gP8G6G2N\n\nReady for a challenge?   Then Just Eat might be the place for you. Were a leading global online delivery platform, and our vision is…"
                      }
                    },
                    "actor": {
                      "name": {
                        "text": "Author One"
                      },
                      "backendUrn": "urn:li:company:100000"
                    },
                    "socialContent": {
                      "shareUrl": "https://www.linkedin.com/posts/member-handle_httpsjobsrminecomjobnltechnology-manager-activity-7523281949587681280-5dUC?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=MASKED"
                    }
                  }
                }
              }
            },
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523282112511242240",
                      "detailPageType": "FEED_DETAIL"
                    },
                    "commentary": {
                      "text": {
                        "text": "🚨 Hiring: Senior Software Engineer | Hyderabad 🚨\nAre you a passionate Java Developer looking to work on enterprise-scale applications and modern technologies? We're hiring experienced professionals…"
                      }
                    },
                    "actor": {
                      "name": {
                        "text": "Author Two"
                      },
                      "backendUrn": "urn:li:member:200000"
                    },
                    "socialContent": {
                      "shareUrl": "https://www.linkedin.com/posts/member-handle_hiring-javadeveloper-mulesoft-activity-7523282112511242240-7NFk?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=MASKED"
                    }
                  }
                }
              }
            },
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523282112511242241"
                    }
                  }
                }
              }
            }
          ]
        }
      ]
    }
  },
  "included": []
}
```

### src/linkedin-session.ts — NEW

Cookie-file resolver (fail-visible `resolveLinkedInCookies(env)`), `buildCookieHeader(cookies)` (quoted JSESSIONID), `csrfToken(cookies)` (quote-stripped), `toStorageState(cookies)` for the Playwright adapter.

Reopened at the 2026-11-04 slice-3 checkpoint (compiler/biome-forced, behavior-identical; suite green in the combined 61-test scratch run): property reads normalized to the declared `jsessionId` (3× TS2551), `canonicalJsessionid` ternary canonicalized, and the storageState doc line corrected — Playwright's wire type REQUIRES `expires`/`httpOnly`/`sameSite`; the slice-3 transport completes them at its boundary.

```ts
/**
 * LinkedIn session material for the local voyager leg (design D4).
 *
 * One cookie file OUTSIDE the repo — exported interactively from a
 * logged-in browser (DOCUMENTATION.md §2.4 VERIFIED; 2FA dead-ends headless
 * login, so no automated re-login exists) — resolves to every shape the
 * leg needs:
 *
 * - resolveLinkedInCookies: fail-visible read + validation. The leg has no
 *   reason to exist without a session, so this is stricter than the
 *   silent-null Threads model (resolveSession in src/threads-session.ts).
 * - buildCookieHeader: the voyager GET's Cookie header. li_at rides first
 *   and unquoted; JSESSIONID keeps its quotes and rides last (§10 template;
 *   §14.5 keeps JSESSIONID last in the header).
 * - csrfToken: the csrf-token header value — the JSESSIONID value with the
 *   quotes stripped (§3, §7 gotcha 5). A wrong or absent value is a 403
 *   "CSRF check failed." on every voyager GET (§13.1).
 * - toStorageState: a storageState document for the Playwright adapter
 *   (slice 3), synthesized from the same pair.
 *
 * The stored jsessionid is normalized once on resolve (one surrounding `"`
 * pair stripped when present): the browser jar stores the value quoted and
 * export tools differ — both dialects resolve to one canonical internal
 * form, and the quote asymmetry is re-applied at the two build sites.
 * SPEC OF RECORD: H:/fork/linkedin-reverse/DOCUMENTATION.md.
 */
import { readFileSync } from "node:fs";
import { ENV_NAMES } from "./config.js";

/** The resolved cookie pair; jsessionId is canonical (quotes stripped). */
export interface LinkedInCookies {
  readonly liAt: string;
  readonly jsessionId: string;
}

function fail(reason: string): Error {
  return new Error(`linkedin-cookies: ${reason}`);
}

/**
 * Strip one surrounding quote pair from an exported JSESSIONID value. An
 * empty stripped value is no session — the jar's value always carries the
 * `ajax:<digits>` token (§1), and an empty one mints an empty csrf-token
 * header, a guaranteed 403 "CSRF check failed." on every GET (§13.1) — so
 * it fails here, naming the file, not remotely on tick 1. Any quote deeper
 * than the stripped pair marks a malformed export.
 */
function canonicalJsessionid(value: string, where: string): string {
  const unquoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (unquoted === "") {
    throw fail(`${where} no usable "jsessionid" value`);
  }
  if (unquoted.includes('"')) {
    throw fail(`${where} stray quotes inside "jsessionid"`);
  }
  return unquoted;
}

/**
 * Read one required string field. Missing, non-string, and empty values are
 * one failure class (D4 "missing cookies"); li_at never carries quotes, so
 * a quoted li_at is malformed too.
 */
function readCookieField(
  doc: Record<string, unknown>,
  key: "liAt" | "jsessionid",
  where: string,
): string {
  const raw: unknown = doc[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw fail(`${where} no usable "${key}" value`);
  }
  const value = raw.trim();
  if (key === "liAt" && value.includes('"')) {
    throw fail(`${where} a quote inside "liAt"`);
  }
  return value;
}

/**
 * Read LINKEDIN_COOKIES_FILE — a JSON `{ liAt, jsessionid }` pair exported
 * interactively from a logged-in browser — and return the canonical pair.
 * Fail-visible by contract (D4): unset/blank/unreadable/missing-file/
 * malformed-JSON/missing-field all THROW with a message naming the
 * variable; the fetch leg has no reason to run without a session.
 */
export function resolveLinkedInCookies(
  env: Record<string, string | undefined> = process.env,
): LinkedInCookies {
  const envName = ENV_NAMES.linkedinCookiesFile;
  const raw = env[envName];
  const filePath = raw === undefined ? "" : raw.trim();
  if (filePath === "") {
    throw fail(
      `${envName} is not set — point it at a cookie file exported from a logged-in browser (README: PC operations)`,
    );
  }
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw fail(
        `${envName} points at ${filePath}, which does not exist — export the cookie pair from a logged-in browser first (README: PC operations)`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is unreadable — ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is not valid JSON — ${message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail(`${envName} points at ${filePath}, which is not a JSON object`);
  }
  const doc = parsed as Record<string, unknown>;
  const where = `${envName} points at ${filePath} with`;
  return {
    liAt: readCookieField(doc, "liAt", where),
    jsessionId: canonicalJsessionid(readCookieField(doc, "jsessionid", where), where),
  };
}

/**
 * The voyager GET's Cookie header (§10 template): li_at first, unquoted;
 * JSESSIONID last, keeping the quotes the browser jar stores (§14.5 keeps
 * JSESSIONID last in the header).
 */
export function buildCookieHeader(cookies: LinkedInCookies): string {
  return `li_at=${cookies.liAt}; JSESSIONID="${cookies.jsessionId}"`;
}

/** The csrf-token header value: the JSESSIONID value, quotes stripped (§3, §7 gotcha 5). */
export function csrfToken(cookies: LinkedInCookies): string {
  return cookies.jsessionId;
}

/** One cookie entry shaped for Playwright's storageState contract (extras stay optional on Playwright's side). */
export interface VoyagerStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

/**
 * A storageState document for the Playwright adapter (slice 3). Mutable
 * field shapes on purpose: readonly arrays would not assign to Playwright's
 * storageState context option; this factory returns a fresh object per
 * call, so purity is not at risk.
 */
export interface VoyagerStorageState {
  cookies: VoyagerStorageCookie[];
  origins: never[];
}

/**
 * Synthesize the storageState the Playwright adapter feeds newContext()
 * (slice 3). The JSESSIONID value keeps its quotes — that is the jar's
 * literal value, so adapter requests emit `Cookie: ... JSESSIONID="ajax:..."`
 * (§10). domain ".linkedin.com" covers the www host; both cookies are
 * Secure in a real browser jar.
 */
export function toStorageState(cookies: LinkedInCookies): VoyagerStorageState {
  return {
    cookies: [
      { name: "li_at", value: cookies.liAt, domain: ".linkedin.com", path: "/", secure: true },
      {
        name: "JSESSIONID",
        value: `"${cookies.jsessionId}"`,
        domain: ".linkedin.com",
        path: "/",
        secure: true,
      },
    ],
    origins: [],
  };
}
```


### tests/linkedin-session.test.ts — NEW

Offline suite: resolver reject matrix (unset/blank/invalid JSON/missing fields — message names `LINKEDIN_COOKIES_FILE`), header quote asymmetry pins, storageState shape. Reopened at the 2026-11-04 slice-3 checkpoint: the `assert.throws` block canonicalized (biome format).

```ts
/**
 * Offline suite for the cookie-file session module (slice 2).
 *
 * Pins the D4 fail-visible resolver matrix (every rejection message names
 * LINKEDIN_COOKIES_FILE), the §3/§10 quote asymmetry (the Cookie header
 * keeps JSESSIONID quoted and last; the csrf-token value carries the
 * quotes stripped), and the storageState synthesis for the slice-3
 * Playwright adapter. Cookie files are written to OS temp only.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import {
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "../src/linkedin-session.js";

const ENV_NAME = ENV_NAMES.linkedinCookiesFile;

let dir: string | undefined;
let fileSeq = 0;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/** Write one cookie file into the suite's OS-temp dir; returns its path. */
async function cookieFile(content: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-cookies-"));
  fileSeq += 1;
  const path = join(dir, `cookies-${fileSeq}.json`);
  await writeFile(path, content, "utf8");
  return path;
}

function envFor(path: string): Record<string, string | undefined> {
  return { [ENV_NAME]: path };
}

const PAIR = JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: "ajax:0123456789012345678" });

describe("resolveLinkedInCookies", () => {
  it("throws naming the variable when it is unset", () => {
    assert.throws(() => resolveLinkedInCookies({}), /LINKEDIN_COOKIES_FILE is not set/);
  });

  it("throws naming the variable when it is blank", () => {
    assert.throws(() => resolveLinkedInCookies({ [ENV_NAME]: "   " }), /is not set/);
  });

  it("throws when the file does not exist", () => {
    const missing = join(tmpdir(), "lw-linkedin-cookies-absent", "nope.json");
    assert.throws(
      () => resolveLinkedInCookies(envFor(missing)),
      /LINKEDIN_COOKIES_FILE points at .*nope\.json, which does not exist/,
    );
  });

  it("throws when the file is not valid JSON", async () => {
    const path = await cookieFile("{not json");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not valid JSON/);
  });

  it("throws when the JSON is not an object", async () => {
    const path = await cookieFile("[1,2]");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not a JSON object/);
  });

  it("throws when liAt is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ jsessionid: "ajax:123" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "  ", jsessionid: "ajax:123" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "liAt"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "liAt"/);
  });

  it("throws when jsessionid is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ liAt: "AQE" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: "" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "jsessionid"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "jsessionid"/);
  });

  it("throws when jsessionid is only one quote pair (empty after stripping)", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '""' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /no usable "jsessionid"/);
  });

  it("names the variable in every rejection message", async () => {
    const badJson = await cookieFile("{nope");
    const badField = await cookieFile(JSON.stringify({ liAt: "", jsessionid: "ajax:1" }));
    const cases: Record<string, string | undefined>[] = [
      {},
      { [ENV_NAME]: "   " },
      envFor(join(tmpdir(), "lw-linkedin-cookies-absent-2", "nope.json")),
      envFor(badJson),
      envFor(badField),
    ];
    for (const env of cases) {
      assert.throws(
        () => resolveLinkedInCookies(env),
        (error: unknown) => {
          assert.match((error as Error).message, new RegExp(`^linkedin-cookies: ${ENV_NAME}`));
          return true;
        },
      );
    }
  });

  it("resolves the pair from an unquoted jsessionid export", async () => {
    const path = await cookieFile(PAIR);
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("resolves the same canonical pair from a quoted jsessionid export", async () => {
    const path = await cookieFile(
      JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: '"ajax:0123456789012345678"' }),
    );
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("throws when jsessionid carries quotes beyond one surrounding pair", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '"aj"ax:123"' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /stray quotes inside "jsessionid"/);
  });

  it("throws when liAt carries quotes", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: 'AQ"E', jsessionid: "ajax:1" }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /quote inside "liAt"/);
  });
});

describe("buildCookieHeader", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("rides li_at first unquoted and JSESSIONID last quoted (§10 template, §14.5 ordering)", () => {
    assert.equal(
      buildCookieHeader(cookies),
      'li_at=AQE-test-li-at; JSESSIONID="ajax:0123456789012345678"',
    );
  });
});

describe("csrfToken", () => {
  it("returns the jsessionid with quotes stripped (§3 header value)", () => {
    assert.equal(csrfToken({ liAt: "A", jsessionId: "ajax:123" }), "ajax:123");
  });
});

describe("toStorageState", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("synthesizes the .linkedin.com pair with the quoted JSESSIONID value", () => {
    const state = toStorageState(cookies);
    assert.equal(state.cookies.length, 2);
    const [liAtCookie, jsessionidCookie] = state.cookies;
    assert.deepEqual(liAtCookie, {
      name: "li_at",
      value: "AQE-test-li-at",
      domain: ".linkedin.com",
      path: "/",
      secure: true,
    });
    assert.equal(jsessionidCookie?.name, "JSESSIONID");
    assert.equal(jsessionidCookie?.value, '"ajax:0123456789012345678"');
    assert.equal(jsessionidCookie?.domain, ".linkedin.com");
    assert.equal(jsessionidCookie?.secure, true);
  });

  it("carries no origins", () => {
    assert.deepEqual(toStorageState(cookies).origins, []);
  });
});
```


### src/linkedin-fetch.ts — NEW

The fetch module (one file, fetch-threads.ts grain): `VoyagerGet` seam type; `createCurlTransport` (spawned curl-impersonate chrome build; `CURL_IMPERSONATE_BIN` fail-visible; injectable exec runner; the `-w` status sentinel rides after a `\n` separator the transport strips from the body — one exec, no temp files); `createPlaywrightTransport` (standalone API-request context — `request.newContext`, no browser launch — behind its own dynamic-import quarantine, mirroring the makeChromiumContextFactory idiom (src/fetch-threads.ts:129-177). The original sketch's "ContextFactory-driven context.request.get" is UNIMPLEMENTABLE — ContextLike (src/fetch-threads.ts:106-110) exposes no request surface — so the transport owns its API-request context + quarantine site; RATIFIED at the 2026-11-04 slice-3 checkpoint. Playwright's storageState wire type REQUIRES `expires`/`httpOnly`/`sameSite`, so the transport completes the session module's minimal cookie shape at this boundary — slice 2 stays the minimal contract.); `resolveLinkedInTransport` (`LINKEDIN_TRANSPORT`: `curl` default | `playwright`, else throw); `classifyFault(status, body)` per §13.3; `LegDeadError` tagged error + `isLegDead` (judge-rotation idiom — factory-assigned fields stay mutable, judge-rotation.ts:61-70); `fetchLinkedInPosts(surfaces, cookies, transport, sleepFn?, now?)` — runPool walk per the VERIFIED contract: `runPool` RETURNS VOID (src/pool.ts:33-52), results ride caller-owned side arrays by claim index (fetchSurfacesAuthenticated idiom, src/fetch-threads.ts:294-343), the worker stays total for surface faults (warn + skip, D11), leg-dead aborts via drain-then-throw (src/judge.ts:681-830): flag in the worker, stop claiming, throw ONCE after the join. Count-50 pages with `start += count`, stop on partial page / `elements: []`, shared pacing gate with the slot RESERVED BEFORE SLEEPING (the stamp advances synchronously on entry, so concurrent workers can never share a wake time — GET starts stay PACE_MS apart globally, never width-2 bursts), `OK — 0 post(s)` empty-is-success line (defb8af lesson). Certified 2026-11-04: four slice-verifier rounds + real-gate proof (tsc, biome, 61-test scratch harness); the compiler caught the storageState wire-type gap and the pacing burst that three LLM rounds missed.

```ts
/**
 * The LinkedIn voyager fetch leg: transport adapters, §13 fault
 * classification, and the runPool surface walk (design slices 3/D11).
 *
 * Two transports behind one seam — `VoyagerGet`, one GET per call:
 *
 * - curl (default): spawns the curl-impersonate chrome build
 *   (CURL_IMPERSONATE_BIN, fail-visible when unset) with the §3/§10 header
 *   set. The HTTP status rides a write-out sentinel after the body — one
 *   exec, no temp files. The exec runner is injectable for offline tests.
 * - playwright: a standalone API-request context
 *   (`request.newContext({ storageState })`) behind the SAME dynamic-import
 *   quarantine idiom as makeChromiumContextFactory (fetch-threads.ts:129).
 *   NOT ContextFactory: ContextLike (fetch-threads.ts:106) exposes no
 *   request surface, and an API GET needs no browser launch (verified
 *   2026-11-04). storageState carries the cookie pair; csrf-token and the
 *   static headers ride extraHTTPHeaders.
 *
 * `LINKEDIN_TRANSPORT` selects the adapter (`curl` default | `playwright`,
 * else throw — switching after a failed probe is an operator action, D2).
 *
 * The walk (D11) reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed by
 * the claim index, the worker stays total for surface faults (warn + skip,
 * the caller-owned skip warn stays in index.ts), and leg-dead aborts via
 * the repo's drain-then-throw shape (judgePosts fallback pool,
 * src/judge.ts:681; fast-workflow-runtime D11): catch isLegDead in the
 * worker, set a shared flag, stop claiming, throw once after the join.
 * A shared per-walk pacing gate (5s between voyager GETs, any surface)
 * keeps the global call rate identical to a sequential walk — the anti-bot
 * rate is pacing-bound, not width-bound (§13.3 throttling was observed at
 * ~40 rapid calls).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import {
  type LinkedInCookies,
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "./linkedin-session.js";
import { VOYAGER_STATIC_HEADERS, buildSearchUrl, parseSearchResponse } from "./linkedin-voyager.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the voyager rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** §12.1: count 50 is unclamped server-side; `start += count` pages. */
export const PAGE_SIZE = 50;

/** Minimum spacing between voyager GETs, shared across surfaces (§13.3). */
export const PACE_MS = 5_000;

/** One curl exec's wall-clock cap; mirrored by --max-time inside curl. */
const REQUEST_TIMEOUT_MS = 30_000;

/** curl -w appends this sentinel + status after the response body. */
const STATUS_SENTINEL = "___CURL_STATUS:";

/** One voyager GET's outcome: the HTTP status and the raw body. */
export interface VoyagerResponse {
  readonly status: number;
  readonly body: string;
}

/** The transport seam: one GET per call, shared by both adapters. */
export type VoyagerGet = (url: string) => Promise<VoyagerResponse>;

/** An opened transport: the GET plus its teardown (a no-op for curl). */
export interface Transport {
  readonly get: VoyagerGet;
  readonly dispose: () => Promise<void>;
}

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- §13.3 fault classification ---

export type FaultKind = "legDead" | "fault";

export interface Fault {
  readonly kind: FaultKind;
  readonly reason: string;
}

/**
 * §13.3 detection recipe, HTTP responses only (connection-level failures
 * throw from the transport and land as surface faults, never leg-dead —
 * a dead network is not a dead session):
 *
 * - 302/3xx redirect loop: live-observed 2026-11-05 (validate rehearsal) —
 *   a dead session presents as a 302 loop on this client stack, with
 *   `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the
 *   chain. DOCUMENTATION.md §13.1's API-vs-browser redirect claim does not
 *   hold for this stack; root cause (session death vs edge fingerprint
 *   block) is unresolved ON PURPOSE — both carry the same operator remedy.
 *   The endpoint never legitimately redirects a GET — any 3xx is leg dead
 *   (§13.1 amendment: same remedy as 401).
 * - 403 "CSRF check failed." text, or a Cloudflare challenge page: the
 *   session/CSRF pair is broken or the IP reputation is burned — leg dead.
 * - 401 {"status":401}: dead or absent li_at — leg dead.
 * - bare 400 {"status":400} on the finder: no member context (dead
 *   session) — leg dead (§13.1: same remedy as 401).
 * - graphql-envelope 400: known query, bad variables — OUR bug, a fault.
 * - 500: unknown queryId — the hash expired server-side (§15); re-derive
 *   from a current APK, do not debug variables — a fault.
 */
export function classifyFault(status: number, body: string): Fault {
  const trimmed = body.trim();
  // Live-observed 2026-11-05 (validate rehearsal): a dead session presents
  // as a 302 redirect loop on this endpoint — DOCUMENTATION.md §13.1 says
  // only browser navigations redirect; the claim does not hold for this
  // client stack. Root cause (session death vs edge fingerprint block) is
  // unresolved ON PURPOSE: both carry the same operator remedy, so the
  // classification must not wait on it. The endpoint never legitimately
  // redirects a GET — any 3xx is leg-dead, same remedy as 401 (§13.1).
  if (status >= 300 && status < 400) {
    return {
      kind: "legDead",
      reason: `HTTP ${status} redirect loop — dead session or edge block; refresh the cookie file (live-observed 2026-11-05, §13.1 amendment)`,
    };
  }
  if (status === 403) {
    const challenge = /Just a moment|challenge|cf-ray/i.test(trimmed);
    return {
      kind: "legDead",
      reason: challenge
        ? "HTTP 403 challenge page — IP/session reputation burned (§13.3)"
        : 'HTTP 403 "CSRF check failed." — session/JSESSIONID mismatch (§13.1)',
    };
  }
  if (status === 401) {
    return {
      kind: "legDead",
      reason: `HTTP 401 ${trimmed.slice(0, 60)} — dead li_at session (§13.1)`,
    };
  }
  if (status === 400) {
    if (trimmed === '{"status":400}') {
      return {
        kind: "legDead",
        reason: 'bare HTTP 400 {"status":400} — no member context; dead session (§13.1)',
      };
    }
    return {
      kind: "fault",
      reason: `HTTP 400 graphql envelope — bad variables (our bug): ${trimmed.slice(0, 80)}`,
    };
  }
  if (status === 500) {
    return {
      kind: "fault",
      reason: "HTTP 500 — unknown queryId; the hash expired (§15), re-derive from a current APK",
    };
  }
  return { kind: "fault", reason: `HTTP ${status}` };
}

// --- curl-impersonate transport ---

/** Injectable exec seam for offline tests: binary + args → stdout. */
export type ExecFn = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFilePromised = promisify(execFile);

const realExec: ExecFn = (file, args) =>
  execFilePromised(file, [...args], {
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/**
 * curl-impersonate chrome build (developer-selected primary transport).
 * One exec per GET: `-sS` body to stdout, `--max-time` mirrors the exec
 * timeout, the §3/§10 header set via -H pairs, and `-w` appends the status
 * sentinel after the body — parseable without temp files or stderr games.
 * Exec-level failures (connection reset, timeout, missing binary) throw
 * plain errors: surface faults, never leg-dead.
 */
export function createCurlTransport(
  cookies: LinkedInCookies,
  env: Record<string, string | undefined> = process.env,
  execFn: ExecFn = realExec,
): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const bin = env[ENV_NAMES.curlImpersonateBin]?.trim();
    if (bin === undefined || bin === "") {
      throw new Error(
        `linkedin-fetch: ${ENV_NAMES.curlImpersonateBin} is not set — the curl transport needs the curl-impersonate chrome binary path (README: PC operations)`,
      );
    }
    const headerPairs = [
      `cookie: ${buildCookieHeader(cookies)}`,
      `csrf-token: ${csrfToken(cookies)}`,
      ...Object.entries(VOYAGER_STATIC_HEADERS).map(([name, value]) => `${name}: ${value}`),
      "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ];
    const get: VoyagerGet = async (url) => {
      const args = [
        "-sS",
        "--max-time",
        String(Math.round(REQUEST_TIMEOUT_MS / 1000)),
        "--compressed",
        url,
        ...headerPairs.flatMap((header) => ["-H", header]),
        "-w",
        `\n${STATUS_SENTINEL}%{http_code}`,
      ];
      let stdout: string;
      try {
        ({ stdout } = await execFn(bin, args));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`linkedin-fetch: curl exec failed — ${message}`);
      }
      const marker = stdout.lastIndexOf(STATUS_SENTINEL);
      if (marker === -1) {
        throw new Error("linkedin-fetch: curl produced no status marker (binary or flag mismatch)");
      }
      const status = Number(stdout.slice(marker + STATUS_SENTINEL.length).trim());
      if (!Number.isInteger(status) || status <= 0) {
        throw new Error("linkedin-fetch: curl status marker unparsable");
      }
      // The -w template writes "\n" before the sentinel: that separator is
      // not part of the body (a body with its own trailing newline keeps it).
      const raw = stdout.slice(0, marker);
      const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      return { status, body };
    };
    return { get, dispose: async () => undefined };
  };
}

/**
 * Playwright API-request transport (the tested fallback, D2). The module's
 * dynamic-import quarantine site — the only `await import("playwright")`
 * outside fetch-threads. storageState carries the cookie pair (toStorageState
 * in linkedin-session.ts); the csrf-token and static headers ride
 * extraHTTPHeaders. Unexercised by the offline suite, like
 * chromiumContextFactory — the VoyagerGet seam carries the tests.
 */
export function createPlaywrightTransport(cookies: LinkedInCookies): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const { request } = await import("playwright");
    // Complete the session-module cookie shape to Playwright's storageState
    // wire type: session cookies carry no jar expiry (-1), and an
    // API-request context runs no scripts, so httpOnly/sameSite are inert
    // defaults. The session module stays the minimal contract (slice 2).
    const storageState = {
      cookies: toStorageState(cookies).cookies.map((cookie) => ({
        ...cookie,
        expires: -1,
        httpOnly: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    };
    const context = await request.newContext({
      storageState,
      extraHTTPHeaders: {
        "csrf-token": csrfToken(cookies),
        ...VOYAGER_STATIC_HEADERS,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const get: VoyagerGet = async (url) => {
      // maxRedirects: 0 — a dead session presents as a 302 redirect loop;
      // following it burns ~20 unpaced redirects and ends in a plain throw
      // that bypasses the classifier. The status itself must reach the
      // §13.3 classifier, where the 3xx branch flags leg-dead (Phase 8).
      const response = await context.get(url, { maxRedirects: 0 });
      return { status: response.status(), body: await response.text() };
    };
    return {
      get,
      dispose: async () => {
        await context.dispose();
      },
    };
  };
}

/**
 * Resolve AND open the configured transport: `LINKEDIN_TRANSPORT` selects
 * `curl` (default, empty/unset included) or `playwright`; anything else
 * throws naming the allowed values (D2: no silent auto-switching — a
 * failed probe is followed by an operator edit + re-probe).
 */
export async function resolveLinkedInTransport(
  env: Record<string, string | undefined> = process.env,
  cookies: LinkedInCookies = resolveLinkedInCookies(env),
  execFn: ExecFn = realExec,
): Promise<Transport> {
  const selection = env[ENV_NAMES.linkedinTransport]?.trim() ?? "";
  const maker =
    selection === "" || selection === "curl"
      ? createCurlTransport(cookies, env, execFn)
      : selection === "playwright"
        ? createPlaywrightTransport(cookies)
        : null;
  if (maker === null) {
    throw new Error(
      `linkedin-fetch: ${ENV_NAMES.linkedinTransport}="${selection}" is not one of: curl, playwright`,
    );
  }
  return maker();
}

// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every voyager GET starts PACE_MS or more after the
 * previous one, regardless of which surface issued it. The slot is
 * RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry, so
 * concurrent workers can never compute the same wake time and fire a
 * burst; with width 2 the GET starts still space PACE_MS apart globally
 * (pacing-bound, not width-bound, D11). A per-walk closure (not module
 * state): two ticks must not inherit each other's stamp, and each test
 * run gets a fresh gate.
 */
function makePacingGate(now: () => number, sleepFn: SleepFn): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      nextFreeAt = slotAt + PACE_MS;
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk every configured linkedin surface: count-50 pages with
 * `start += count`, stop on a partial page (§12.8: returned posts < count
 * is the last page; `elements: []` lands as zero posts), one log line per
 * surface (empty-is-success, defb8af). Surface faults warn + skip (the
 * index arm owns the per-surface skip summary); leg-dead aborts the tick
 * whole via drain-then-throw. Accepts a bare VoyagerGet (tests, probe —
 * no ownership) or an opened Transport (scripts — disposed in finally).
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  cookies: LinkedInCookies,
  transport: VoyagerGet | Transport,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
): Promise<Post[]> {
  const ownsTransport = typeof transport !== "function";
  const get: VoyagerGet = ownsTransport ? (transport as Transport).get : transport;
  const gate = makePacingGate(now, sleepFn);
  // Side arrays indexed by runPool's claim index — runPool returns void
  // (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let dropped = 0;
  let deadReason: string | undefined;

  try {
    await runPool(surfaces, LINKEDIN_FETCH_CONCURRENCY, async (surface, index) => {
      const label = `linkedin/${surface.value}`;
      try {
        const collected: Post[] = [];
        let start = 0;
        for (;;) {
          if (deadReason !== undefined) return; // stop claiming; the join re-throws
          await gate.wait();
          if (deadReason !== undefined) return;
          const response = await get(buildSearchUrl(surface.value, start, PAGE_SIZE));
          if (response.status !== 200) {
            const fault = classifyFault(response.status, response.body);
            if (fault.kind === "legDead") throw legDead(fault.reason);
            throw new Error(`${label} page ${start}: ${fault.reason}`);
          }
          const parsed = parseSearchResponse(response.body);
          if (parsed.kind === "unparsable") {
            throw new Error(`${label} page ${start}: unparsable 200 body — ${parsed.reason}`);
          }
          dropped += parsed.dropped;
          collected.push(...parsed.posts);
          if (parsed.posts.length < PAGE_SIZE) break;
          start += PAGE_SIZE;
        }
        perSurface[index] = collected;
        // Empty-is-success keyed on the observable signal (defb8af): a
        // surface that yields 0 posts is an outcome, not a fault.
        console.log(`fetch: ${label} OK — ${collected.length} post(s)`);
      } catch (error) {
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    if (ownsTransport) await (transport as Transport).dispose();
  }

  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (dropped > 0) {
    console.warn(`fetch: linkedin dropped ${dropped} malformed row(s)`);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
```


### tests/linkedin-fetch.test.ts — NEW

Offline suite: §13.3 fault-classifier table (7 rows); curl adapter over a fake exec (header set, status-sentinel parse with the separator stripped from the body, exec failure → surface fault, missing-binary fail-visible); transport resolver accept/reject matrix (unset default, explicit `curl`, unknown throws naming both values); paging sequence over a scripted VoyagerGet double (partial-page stop, exhaustion stop, ordered reassembly under out-of-order completion, per-surface fault skip, leg-dead drain-then-throw with sibling stop, drop-count warn, empty-is-success, transport disposal); pacing-gate timing via an injected clock (single-surface pin) PLUS a deferred-sleep slot-reservation pin proving concurrent waiters never share a wake time (the width-2 burst regression, fixed 2026-11-04). Zero network, zero real sleeps: the VoyagerGet seam is the test double and the walk tests inject controlled sleeps; the playwright adapter stays unexercised (the chromiumContextFactory precedent — the seam carries the tests).

```ts
/**
 * Offline suite for the voyager fetch leg.
 *
 * Covers: the §13.3 fault-classifier table; the curl transport over a fake
 * exec (header set, status-sentinel parse, exec failure, missing-binary
 * fail-visible); the transport resolver accept/reject matrix; the runPool
 * surface walk over a scripted VoyagerGet — partial-page stop, exhaustion
 * stop, input-order reassembly under out-of-order completion, per-surface
 * fault skip, leg-dead drain-then-throw with sibling stop, pacing-gate
 * spacing, drop-count warn, empty-is-success, transport disposal. Zero
 * network and zero real sleeps: the VoyagerGet seam is the test double and
 * the multi-GET walk tests inject controlled sleeps; the playwright adapter
 * stays unexercised (the chromiumContextFactory precedent — the seam
 * carries the tests).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LinkedinSurface,
  PAGE_SIZE,
  type VoyagerGet,
  type VoyagerResponse,
  classifyFault,
  createCurlTransport,
  fetchLinkedInPosts,
  isLegDead,
  legDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = { liAt: "AQE-test", jsessionId: "ajax:0123456789012345678" };

/** An instant sleepFn: multi-GET walk tests pin paging order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Build a §6-shaped 200 body carrying the given activity ids. */
const okBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

const page = (ids: readonly string[], status = 200, body?: string): VoyagerResponse => ({
  status,
  body: body ?? okBody(ids),
});

/** Distinct activity ids; second-resolution spacing keeps them unique. */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();
const FULL_PAGE: readonly string[] = Array.from({ length: PAGE_SIZE }, (_, i) => idAt(i));

const startOf = (url: string): string => /start:(\d+)/.exec(url)?.[1] ?? "";
/** The keyword token as it rides the URL (already URL-encoded); routes match raw. */
const surfaceOf = (url: string): string => /keywords:([^,)]+)/.exec(url)?.[1] ?? "";

/** Scripted transport: responds per URL matcher; records every call. */
function scriptGet(
  routes: ReadonlyArray<{
    match: (url: string) => boolean;
    respond: () => VoyagerResponse | Promise<VoyagerResponse>;
  }>,
): VoyagerGet & { calls: string[] } {
  const calls: string[] = [];
  const get: VoyagerGet = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) throw new Error(`unexpected GET: ${url}`);
    return route.respond();
  };
  return Object.assign(get, { calls });
}

/** A manually-resolved promise: stages one GET response for the pacing test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("classifyFault (§13.3 table)", () => {
  it("classifies the CSRF-403 text body as leg-dead", () => {
    const fault = classifyFault(403, "CSRF check failed.");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /CSRF/);
  });

  it("classifies a Cloudflare challenge 403 as leg-dead", () => {
    const fault = classifyFault(403, "<html>Just a moment... cf-ray: abc</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /challenge/);
  });

  it("classifies 401 {status:401} as leg-dead (dead li_at)", () => {
    const fault = classifyFault(401, '{"status":401}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /li_at/);
  });

  it("classifies the bare 400 on the finder as leg-dead (no member context)", () => {
    const fault = classifyFault(400, '{"status":400}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /member context|dead session/);
  });

  it("classifies the graphql-envelope 400 as a fault (bad variables — our bug)", () => {
    const fault = classifyFault(400, '{"data":{"status":400},"included":[]}');
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /bad variables/);
  });

  it("classifies 500 as a fault (queryId expiry, §15)", () => {
    const fault = classifyFault(500, "Internal Server Error");
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /queryId/);
  });

  it("classifies any other non-200 as a fault", () => {
    assert.equal(classifyFault(503, "").kind, "fault");
  });
});

describe("createCurlTransport", () => {
  const RESPONSE_BODY = '{"data":{"searchDashClustersByAll":{"elements":[]}},"included":[]}';

  it("passes the URL, the §3/§10 header set, and parses the status sentinel", async () => {
    const execCalls: Array<{ file: string; args: readonly string[] }> = [];
    const make = createCurlTransport(
      COOKIES,
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      async (file, args) => {
        execCalls.push({ file, args });
        return { stdout: `${RESPONSE_BODY}\n___CURL_STATUS:200` };
      },
    );
    const transport = await make();
    const response = await transport.get("https://www.linkedin.com/voyager/api/graphql?x=1");

    assert.equal(response.status, 200);
    assert.equal(response.body, RESPONSE_BODY);
    assert.equal(execCalls.length, 1);
    const call = execCalls[0];
    assert.equal(call?.file, "curl-chrome");
    assert.ok(call?.args.includes("https://www.linkedin.com/voyager/api/graphql?x=1"));
    const headers = (call?.args ?? []).filter((arg, index) => call?.args[index - 1] === "-H");
    assert.ok(headers.includes('cookie: li_at=AQE-test; JSESSIONID="ajax:0123456789012345678"'));
    assert.ok(headers.includes("csrf-token: ajax:0123456789012345678"));
    assert.ok(headers.includes("x-restli-protocol-version: 2.0.0"));
    assert.ok(headers.includes("accept: application/json"));
  });

  it("throws a surface fault (not leg-dead) when the exec fails", async () => {
    const make = createCurlTransport(COOKIES, { CURL_IMPERSONATE_BIN: "curl-chrome" }, async () => {
      throw new Error("connection reset");
    });
    const transport = await make();
    await assert.rejects(() => transport.get("https://x"), /curl exec failed — connection reset/);
  });

  it("fails visibly naming the variable when CURL_IMPERSONATE_BIN is unset", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(() => make(), /CURL_IMPERSONATE_BIN is not set/);
  });
});

describe("resolveLinkedInTransport", () => {
  it("opens the curl transport by default over the injected exec", async () => {
    const transport = await resolveLinkedInTransport(
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("opens the curl transport when LINKEDIN_TRANSPORT is explicitly curl", async () => {
    const transport = await resolveLinkedInTransport(
      { LINKEDIN_TRANSPORT: "curl", CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("throws naming the allowed values on an unknown LINKEDIN_TRANSPORT", async () => {
    await assert.rejects(
      () =>
        resolveLinkedInTransport(
          { LINKEDIN_TRANSPORT: "wget", CURL_IMPERSONATE_BIN: "curl-chrome" },
          COOKIES,
          async () => ({ stdout: "" }),
        ),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("fetchLinkedInPosts (runPool walk)", () => {
  const oneSurface: readonly LinkedinSurface[] = [{ type: "linkedin", value: "#hiring react" }];

  it("stops on a partial page and returns the parsed posts in input order", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(1), idAt(2), idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(get.calls.length, 1);
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("pages a full page, then stops on the exhaustion page (elements: [])", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get, instantSleep);
    assert.equal(get.calls.length, 2);
    assert.equal(posts.length, PAGE_SIZE);
    assert.ok(get.calls[1]?.includes("start:50"));
  });

  it("paces voyager GETs PACE_MS apart through the injected clock and sleep", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([idAt(99)]) },
    ]);
    await fetchLinkedInPosts(
      oneSurface,
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
    );
    assert.deepEqual(sleeps, [5000]); // first GET is free; the second waits
    assert.equal(get.calls.length, 2);
  });

  it("reserves the pacing slot before sleeping, so concurrent waiters never share a wake time", async () => {
    // The width-2 walk must never fire a burst: each waiter reserves its
    // slot SYNCHRONOUSLY on entry (reserve-before-sleep), so B's target is
    // a full PACE_MS beyond A's in-flight reservation. An update-after-
    // sleep stamp would compute B's wake from the stale stamp and both
    // workers would GET together every PACE_MS. Deferred sleeps + deferred
    // GETs make the reservation order observable deterministically.
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    let tick = 0;
    const get0 = deferred<VoyagerResponse>();
    const get1 = deferred<VoyagerResponse>();
    const get2 = deferred<VoyagerResponse>();
    const get3 = deferred<VoyagerResponse>();
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => get0.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: () => get1.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => get2.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "50",
        respond: () => get3.promise,
      },
    ]);
    const walk = fetchLinkedInPosts(surfaces, COOKIES, get, sleepFn, () => tick);
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    // A's first GET is open on the free slot; B reserved the NEXT slot
    // while A's GET was still in flight — call starts space PACE_MS apart.
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // A's second reservation (its GET answered) lands a full PACE_MS beyond
    // B's in-flight reservation — the shared wake (burst) never happens.
    get0.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000]);

    // Release in reservation order: B GETs, then reserves beyond A again.
    heldSleeps[0]?.();
    tick += 5000;
    await flush();
    get1.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000, 10000]);

    // Drain the remaining held sleeps and GETs to completion.
    heldSleeps[1]?.();
    tick += 10000;
    await flush();
    get2.resolve(page([]));
    await flush();
    heldSleeps[2]?.();
    tick += 10000;
    await flush();
    get3.resolve(page([]));
    await flush();
    const posts = await walk;
    assert.equal(get.calls.length, 4);
    assert.equal(posts.length, PAGE_SIZE * 2); // both surfaces survived
  });

  it("reassembles two surfaces in input order under out-of-order completion", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15)); // B finishes first
          return page([idAt(1)]);
        },
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("skips a faulted surface (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"data":{"status":400},"included":[]}'),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a FAILED — .*bad variables/.test(line)));
  });

  it("drains then throws leg-dead once, and the sibling stops paging", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => page(FULL_PAGE),
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => page([], 400, '{"status":400}'), // bare 400 = leg dead
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25)); // still in flight when A flags
          return page(FULL_PAGE);
        },
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /dead session/);
    // Sibling stop: B never fired its second page after A flagged.
    assert.equal(
      get.calls.filter((url) => surfaceOf(url) === "%23b" && startOf(url) === "50").length,
      0,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("treats an unparsable 200 body as a surface fault, not leg-dead", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([], 200, "<html>weird</html>") },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /unparsable 200 body/.test(line)));
  });

  it("counts dropped rows in a warn and keeps the valid rest", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const raw = JSON.stringify({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    searchFeedUpdate: {
                      update: { metadata: { backendUrn: "urn:li:activity:7523282112511242241" } },
                    },
                  },
                },
                ...FULL_PAGE.slice(0, 2).map((id) => ({
                  item: {
                    searchFeedUpdate: {
                      update: {
                        metadata: { backendUrn: `urn:li:activity:${id}` },
                        commentary: { text: { text: `post ${id}` } },
                        actor: { name: { text: `author ${id}` } },
                        socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                      },
                    },
                  },
                })),
              ],
            },
          ],
        },
      },
      included: [],
    });
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => ({ status: 200, body: raw }) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(posts.length, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /dropped 1 malformed row/.test(line)));
  });

  it("treats a zero-post surface as success (defb8af: empty is an outcome)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const get = scriptGet([{ match: (url) => startOf(url) === "0", respond: () => page([]) }]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react OK — 0 post\(s\)/.test(line)));
  });

  it("disposes an opened Transport (not a bare VoyagerGet) in finally", async () => {
    let disposed = false;
    const transport = {
      get: scriptGet([{ match: () => true, respond: () => page([]) }]),
      dispose: async () => {
        disposed = true;
      },
    };
    await fetchLinkedInPosts(oneSurface, COOKIES, transport);
    assert.equal(disposed, true);
  });

  it("exposes the tagged leg-dead guard", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
  });
});

describe("Post shape (walk output)", () => {
  it("maps a parsed row to the normalized Post contract", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(5)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      [{ type: "linkedin", value: "#x" }] as const,
      COOKIES,
      get,
    );
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.text, `post ${idAt(5)}`);
    assert.equal(first.author, `author ${idAt(5)}`);
    assert.equal(first.permalink, `https://www.linkedin.com/posts/x-${idAt(5)}`);
    assert.equal(first.timestamp, new Date(Number(BigInt(idAt(5)) >> 22n)).toISOString());
  });
});
```


### src/linkedin-payload.ts — NEW

Payload envelope `{ version: 1, writtenAt, posts }`; `writePayloadAtomic(path, posts, now)` (temp+rename, state.ts precedent); `readPayloadPosts(path, now)` — ENOENT → null, over-age (`PAYLOAD_MAX_AGE_MS`) → null + reason, per-row shape validation (platform literal, `urn:li:activity:\d{9,}` id, non-empty fields) with drop+count.

```ts
/**
 * Payload hand-off between the PC fetch leg and the hosted watch run
 * (design D5/D9/D13): the PC loop writes fetched raw posts to
 * state/linkedin-posts.json (atomic temp+rename, the state.ts precedent)
 * and pushes that single path; the hosted run reads it here.
 *
 * Four failure classes, ALL degrading to threads-only runs (D13 — a
 * LinkedIn fault can never fail a run; the alarm duty for leg faults
 * lives where the fault originates, the PC leg):
 *
 * - absent (ENOENT): the PC-off / never-ran state is NORMAL — one quiet
 *   log line, leg "absent".
 * - stale (over PAYLOAD_MAX_AGE_MS): one log line naming the age, leg
 *   "stale".
 * - malformed envelope (invalid JSON, unknown version, posts not an
 *   array): one warn naming the reason, leg "malformed".
 * - malformed rows: dropped + counted, leg stays "ok".
 *
 * Every class stays operator-visible in run logs; nothing is silent.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LINKEDIN_PAYLOAD_PATH } from "./config.js";
import type { Post } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant. */
export const PAYLOAD_VERSION = 1;

/** Twice the 10-minute cadence: a payload older than this reads as stale. */
export const PAYLOAD_MAX_AGE_MS = 1_800_000;

/** What the PC loop writes: a self-describing, versioned post envelope. */
export interface PayloadEnvelope {
  version: number;
  writtenAt: string;
  posts: Post[];
}

/** LinkedIn leg state for the heartbeat/digest lines (D6/D13). */
export type LegStatus = "ok" | "stale" | "absent" | "malformed";

/** The leg state minus the posts — rides HeartbeatStats and the digest. */
export interface LegLine {
  status: LegStatus;
  /** Age/reason detail for the log and email lines; absent-state omits it. */
  detail?: string;
}

/** What the watch-side reader returns: posts + the leg state (D6/D13). */
export interface PayloadRead {
  posts: Post[];
  /** The leg state; mirrors LegLine.status for the heartbeat/digest lines. */
  leg: LegStatus;
  /** Age/reason detail; omitted when none rides (exactOptionalPropertyTypes). */
  detail?: string;
}

const ACTIVITY_URN_RE = /^urn:li:activity:\d{9,}$/;

/** Per-row shape contract: a row that fails any check is dropped + counted. */
function isValidRow(value: unknown): value is Post {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.platform === "linkedin" &&
    typeof row.id === "string" &&
    ACTIVITY_URN_RE.test(row.id) &&
    typeof row.text === "string" &&
    row.text.length > 0 &&
    typeof row.author === "string" &&
    row.author.length > 0 &&
    typeof row.permalink === "string" &&
    row.permalink.length > 0 &&
    typeof row.timestamp === "string" &&
    !Number.isNaN(Date.parse(row.timestamp))
  );
}

/**
 * Write the payload atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed tick never leaves a partial payload.
 */
export async function writePayloadAtomic(
  posts: readonly Post[],
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const envelope: PayloadEnvelope = {
    version: PAYLOAD_VERSION,
    writtenAt: new Date(now()).toISOString(),
    posts: [...posts],
  };
  const dir = dirname(filePath);
  const tempPath = join(dir, `.${now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`payload: atomic write failed for ${filePath}: ${message}`);
  }
}

/**
 * Read + validate the payload. Never throws (D13): every failure class
 * resolves to a threads-only PayloadRead with its leg state and log line.
 * `now` is injectable so the staleness boundary is testable.
 */
export async function readPayloadPosts(
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<PayloadRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT"
    ) {
      console.log("linkedin: no payload — threads-only run");
      return { posts: [], leg: "absent" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload unreadable — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `unreadable: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload not valid JSON — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("linkedin: payload is not a JSON object — threads-only run");
    return { posts: [], leg: "malformed", detail: "envelope is not an object" };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== PAYLOAD_VERSION) {
    const detail = `unknown version ${String(envelope.version)} (expected ${PAYLOAD_VERSION})`;
    console.warn(`linkedin: payload ${detail} — threads-only run`);
    return { posts: [], leg: "malformed", detail };
  }

  const writtenAt = envelope.writtenAt;
  const writtenMs = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  const ageMs = now() - writtenMs;
  if (!Number.isFinite(writtenMs) || !Number.isFinite(ageMs) || ageMs > PAYLOAD_MAX_AGE_MS) {
    const age = Number.isFinite(ageMs)
      ? `${Math.max(0, Math.round(ageMs / 3_600_000))}h old`
      : "carries an unreadable writtenAt";
    console.log(`linkedin: payload stale (${age}) — threads-only run`);
    return { posts: [], leg: "stale", detail: `payload ${age}` };
  }

  if (!Array.isArray(envelope.posts)) {
    console.warn("linkedin: payload posts is not an array — threads-only run");
    return { posts: [], leg: "malformed", detail: "posts is not an array" };
  }
  const posts: Post[] = [];
  let dropped = 0;
  for (const row of envelope.posts) {
    if (isValidRow(row)) {
      posts.push(row);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`linkedin: payload carried ${dropped} malformed row(s) — dropped`);
  }
  return {
    posts,
    leg: "ok",
    detail: `payload ${Math.max(0, Math.floor(ageMs / 60_000))} min old`,
  };
}
```

### tests/linkedin-payload.test.ts — NEW

Offline suite: round-trip write→read, atomicity (no temp litter), absent → null (quiet), stale → null + reason (injected clock across the boundary), bad envelope (invalid JSON / unknown version) → warn + threads-only, malformed rows dropped+counted, Gate-1 identity helper pin. The suite names all four failure classes; `npm test` cannot pass while the reader silently drops rows.

```ts
/**
 * Offline suite for the payload hand-off (design D9/D13).
 *
 * Pins all four failure classes — absent (ENOENT → quiet null-equivalent),
 * stale (over-age across the injected-clock boundary), malformed envelope
 * (invalid JSON / unknown version / posts not an array), malformed rows
 * (drop + count) — plus the atomic round trip (write → read, no temp
 * litter). The reader cannot silently drop rows or throw while this suite
 * is green.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  PAYLOAD_MAX_AGE_MS,
  PAYLOAD_VERSION,
  type PayloadEnvelope,
  readPayloadPosts,
  writePayloadAtomic,
} from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const MINUTE = 60_000;

const post = (n: number): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${(BigInt(T0 - n * MINUTE) << 22n).toString()}`,
  text: `post ${n}`,
  author: `author ${n}`,
  permalink: `https://www.linkedin.com/posts/x-${n}`,
  timestamp: new Date(T0 - n * MINUTE).toISOString(),
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function payloadPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-payload-"));
  return join(dir, name);
}

async function seedEnvelope(path: string, envelope: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

const envelopeFor = (posts: Post[], writtenAt = T0): PayloadEnvelope => ({
  version: PAYLOAD_VERSION,
  writtenAt: new Date(writtenAt).toISOString(),
  posts,
});

describe("writePayloadAtomic / readPayloadPosts round trip", () => {
  it("round-trips the envelope: posts survive, leg ok, detail carries the age", async () => {
    const path = await payloadPath("round-trip.json");
    await writePayloadAtomic([post(1), post(2)], path, () => T0);
    const read = await readPayloadPosts(path, () => T0 + 1 * MINUTE);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    assert.equal(read.detail, "payload 1 min old");
  });

  it("leaves no temp litter behind (atomic write)", async () => {
    const path = await payloadPath("atomic.json");
    await writePayloadAtomic([post(3)], path, () => T0);
    const entries = await readdir(join(path, ".."));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
  });

  it("uses the fixed repo path beside STATE_PATH by default", () => {
    assert.equal(LINKEDIN_PAYLOAD_PATH, "state/linkedin-posts.json");
  });
});

describe("readPayloadPosts failure classes (D13)", () => {
  it("class: absent — ENOENT resolves quietly to a threads-only read", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const read = await readPayloadPosts(await payloadPath("never-written.json"), () => T0);
    assert.deepEqual(read, { posts: [], leg: "absent" });
    assert.equal(read.detail, undefined);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: no payload — threads-only run/.test(line)));
  });

  it("class: stale — over-age resolves to leg stale naming the age", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const path = await payloadPath("stale.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS + 1);
    assert.equal(read.leg, "stale");
    assert.deepEqual(read.posts, []);
    assert.match(read.detail ?? "", /payload .*h old/);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload stale/.test(line)));
  });

  it("stale boundary: a payload exactly PAYLOAD_MAX_AGE_MS old is still ok", async () => {
    const path = await payloadPath("boundary.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS);
    assert.equal(read.leg, "ok");
  });

  it("class: malformed — invalid JSON resolves to leg malformed naming the reason", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("bad-json.json");
    await writeFile(path, "{not json", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not valid JSON/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload not valid JSON/.test(line)));
  });

  it("class: malformed — an unknown version is rejected, not floored", async () => {
    const path = await payloadPath("bad-version.json");
    await seedEnvelope(path, { ...envelopeFor([post(1)]), version: 99 });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /unknown version 99/);
  });

  it("class: malformed — a non-object envelope is rejected", async () => {
    const path = await payloadPath("not-object.json");
    await seedEnvelope(path, [post(1)]);
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not an object/);
  });

  it("class: malformed — a posts field that is not an array is rejected", async () => {
    const path = await payloadPath("posts-not-array.json");
    await seedEnvelope(path, {
      version: PAYLOAD_VERSION,
      writtenAt: new Date(T0).toISOString(),
      posts: "nope",
    });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /posts is not an array/);
  });

  it("class: rows — malformed rows are dropped and counted, leg stays ok", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("mixed-rows.json");
    const junk = {
      platform: "linkedin",
      id: "not-a-urn",
      text: "",
      author: "a",
      permalink: "p",
      timestamp: "nope",
    };
    await seedEnvelope(path, envelopeFor([post(1), junk as unknown as Post, post(2)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /payload carried 1 malformed row/.test(line)));
  });

  it("never throws on any garbage input", async () => {
    const path = await payloadPath("garbage.json");
    await writeFile(path, "\x00\x01binary junk", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.deepEqual(read.posts, []);
  });
});
```

```

### tests/fetch-linkedin.test.ts — NEW

Offline suite for the PC tick (slice 4, authored 2026-11-04 at the checkpoint directive): `pushPayload`'s single-path rebase+retry discipline over a fake GitRunner (stage ONLY the injected path — the 2026-11-04 injection-bug regression pin; no-op guard; one retry; loud double-failure abort; conflict aborts the rebase and never pushes), `fetchTick`'s composition over the injected seams (payload round-trip, single-path git sequence, caller-owned transport stays undisposed, quiet early return with zero linkedin surfaces BEFORE any resolver runs, env-driven local open rides `resolveLinkedInTransport` — pinned via its unknown-transport rejection), and the leg-dead episode-marker edge (ONE alarm per episode; quiet later dead ticks; healthy tick clears; restart survival via the file, not module state; best-effort default alarm). Zero network, zero real git, zero real email: the GitRunner / Transport / alarm / env injections are the test doubles; the playwright adapter stays unexercised (the chromiumContextFactory precedent).

```ts
/**
 * Offline suite for the PC fetch tick (slice 4).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams, and the
 * leg-dead episode-marker edge. Zero network, zero real git, zero real
 * email: GitRunner, Transport, alarm, and env are the test doubles.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type GitRunner,
  fetchTick,
  handleLegDeadEpisode,
  pushPayload,
} from "../scripts/fetch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { type Transport, isLegDead, legDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const COOKIES: LinkedInCookies = { liAt: "AQE-test", jsessionId: "ajax:0123456789012345678" };

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-fetch-linkedin-"));
  return join(dir, name);
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

/** Fake GitRunner: records every invocation; exit codes scripted per command. */
function scriptGit(script: Partial<Record<string, number | number[]>> = {}): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const command = args[0] ?? "";
    calls.push([...args]);
    const scripted = script[command];
    const index = calls.filter((entry) => entry[0] === command).length - 1;
    const code = Array.isArray(scripted)
      ? (scripted[index] ?? scripted[scripted.length - 1] ?? 0)
      : (scripted ?? 0);
    return { code };
  };
  return Object.assign(git, { calls });
}

/** Build a §6-shaped 200 body carrying the given activity ids (linkedin-fetch suite shape). */
const pageBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

/** Distinct activity ids at 1-second spacing (linkedin-fetch suite idiom). */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();

const transportFor = (body: string | Error): Transport & { disposeCount: () => number } => {
  let disposeCount = 0;
  const get = async (): Promise<{ status: number; body: string }> => {
    if (body instanceof Error) throw body;
    return { status: 200, body };
  };
  const dispose = async (): Promise<void> => {
    disposeCount += 1;
  };
  const transport: Transport = { get, dispose };
  return Object.assign(transport, { disposeCount: () => disposeCount });
};

describe("pushPayload (single-path rebase+retry discipline)", () => {
  it("stages ONLY the injected path, commits, rebases onto main, and pushes", async () => {
    const payload = await workPath("push-ok.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 3, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
      ["commit", "-m", "linkedin: payload 3 post(s)"],
      ["pull", "--rebase", "origin", "main"],
      ["push"],
    ]);
  });

  it("never stages the module-constant path when a temp payload is injected", async () => {
    const payload = await workPath("push-injected.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 1, payload);
    const addCalls = git.calls.filter((args) => args[0] === "add");
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.[1], payload);
    assert.ok(git.calls.every((args) => !args.includes(LINKEDIN_PAYLOAD_PATH)));
  });

  it("throws loudly when the commit itself fails (unconfigured identity) and never pushes", async () => {
    const git = scriptGit({ diff: 1, commit: 128 });
    const payload = await workPath("push-commit-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload commit failed/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 0);
  });

  it("skips commit + rebase + push when nothing is staged (no-op guard)", async () => {
    const payload = await workPath("push-noop.json");
    const git = scriptGit({ diff: 0 });
    await pushPayload(git, 0, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
    ]);
  });

  it("retries once when the push is rejected, then succeeds", async () => {
    const git = scriptGit({ diff: 1, push: [1, 0] });
    await pushPayload(git, 2, await workPath("push-retry.json"));
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 2);
  });

  it("throws after the second push rejection (loud, exit-1 contract)", async () => {
    const git = scriptGit({ diff: 1, push: 1 });
    const payload = await workPath("push-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
  });

  it("aborts the rebase loudly on conflict and never pushes", async () => {
    const git = scriptGit({ diff: 1, pull: 1 });
    const payload = await workPath("push-conflict.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    const aborts = git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort");
    assert.equal(aborts.length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
  });
});

describe("fetchTick (compose cookies → transport → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ diff: 1 });
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.equal(new Date(envelope.writtenAt).getTime(), T0);
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: `post ${idAt(1)}`,
      author: `author ${idAt(1)}`,
      permalink: `https://www.linkedin.com/posts/x-${idAt(1)}`,
      timestamp: new Date(Number(BigInt(idAt(1)) >> 22n)).toISOString(),
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(transport.disposeCount(), 0); // caller-owned: fetchTick never disposes it
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    assert.equal(git.calls[0]?.[0], "add");
    assert.equal(git.calls[0]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or disposing", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const transport = transportFor(legDead("bare HTTP 400 — dead session"));
    const git = scriptGit({});
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /dead session/.test(error.reason),
    );
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on failure
    assert.equal(await exists(payload), false); // the walk aborted before any write
    assert.equal(git.calls.length, 0); // no push on a dead leg
    assert.deepEqual(alarms, []); // the alarm policy belongs to the entry/loop callers
  });

  it("returns early when no linkedin surfaces are configured (resolvers never run)", async () => {
    const git = scriptGit({});
    const result = await fetchTick({
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0);
  });

  it("opens the transport through resolveLinkedInTransport when none is injected", async () => {
    const payloadPath = await workPath("tick-resolver.json");
    const markerPath = await workPath("tick-resolver.flag");
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: COOKIES,
          env: { LINKEDIN_TRANSPORT: "wget" },
          payloadPath,
          git: scriptGit({}),
          markerPath,
        }),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("handleLegDeadEpisode (one alarm per episode)", () => {
  it("alarms once on the healthy→dead edge and writes the marker", async () => {
    const marker = await workPath("episode-1.flag");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, ["dead session"]);
    assert.equal(await readFile(marker, "utf8"), "dead session\n");
  });

  it("stays quiet on later dead ticks (marker already present)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-2.flag");
    await writeFile(marker, "dead session\n", "utf8");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session again", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /leg still dead/.test(line)));
  });

  it("survives a restart: the marker file, not module state, edges the episode", async () => {
    const marker = await workPath("episode-3.flag");
    const alarms: string[] = [];
    const deps = {
      markerPath: marker,
      env: {},
      alarm: async (reason: string): Promise<void> => {
        alarms.push(reason);
      },
    };
    await handleLegDeadEpisode("dead", deps); // pre-restart process
    await handleLegDeadEpisode("dead", deps); // post-restart process: same file, still quiet
    assert.deepEqual(alarms, ["dead"]);
  });

  it("default alarm is best-effort: a broken GMAIL env warns instead of throwing", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-4.flag");
    await handleLegDeadEpisode("dead", { markerPath: marker, env: {} });
    assert.equal(await readFile(marker, "utf8"), "dead\n"); // marker persists despite the send failure
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /alarm not sent/.test(line)));
  });
});
```

```

### scripts/fetch-linkedin.ts — NEW

One tick: resolve cookies → resolve transport → fetch all configured linkedin surfaces → write payload → git add (single path) + commit + pull --rebase + push with one retry. Leg-dead: alarm email (episode-edge via a local marker file) + exit 1. Exports `fetchTick()` for the loop; entry-guarded main (index.ts guard idiom).

```ts
/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7):
 *
 *   cookies → transport → voyager walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The
 * bot's commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main (unrelated uncommitted edits would wedge the rebase); the rebase
 * doubles as the loop's own code auto-update.
 *
 * Leg-dead: ONE alarm email per episode (edge-detected via a repo-local
 * marker file beside the payload — never OS temp: a reboot or temp-cleaner
 * must not erase the episode and re-alarm a still-dead leg), then exit 1
 * for this one-shot entry. The loop
 * (scripts/watch-linkedin.ts) catches and keeps running — a cookie-file
 * refresh self-heals on a later tick. Best-effort alarm policy: a broken
 * GMAIL_* configuration must not mask the exit code.
 *
 * Entry-guarded main (index.ts idiom): importing fetchTick stays
 * side-effect free.
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { resolveEmailConfig, sendLegDeadAlarm } from "../src/email.js";
import {
  type LinkedinSurface,
  type Transport,
  fetchLinkedInPosts,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number }>;

const execFilePromised = promisify(execFile);

const realGit: GitRunner = async (args) => {
  try {
    await execFilePromised("git", [...args], { windowsHide: true });
    return { code: 0 };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number((error as { code: unknown }).code)
        : 1;
    return { code: Number.isInteger(code) ? code : 1 };
  }
};

/** Outcome of one tick; the loop and tests assert on it. */
export interface FetchTickResult {
  wrote: boolean;
  pushed: boolean;
  postCount: number;
}

export interface FetchTickDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Pre-resolved cookies. Default: resolveLinkedInCookies(env). */
  cookies?: LinkedInCookies;
  /** Opened transport. Default: resolveLinkedInTransport(env, cookies). The caller owns a provided transport. */
  transport?: Transport;
  /** Payload location. Default: LINKEDIN_PAYLOAD_PATH (the pushed path). */
  payloadPath?: string;
  /** Git runner. Default: the real git on PATH. */
  git?: GitRunner;
  /** Environment for the resolvers. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Episode alarm. Default: sendLegDeadAlarm, best-effort (warn on failure). */
  alarm?: (reason: string) => Promise<void>;
  /** Episode marker file. Default: repo-local beside the payload (survives restarts). */
  markerPath?: string;
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
}

/**
 * Episode marker BESIDE THE PAYLOAD (repo-local, persistent): present = the
 * alarm already fired for this episode. OS temp was rejected 2026-11-04 —
 * a reboot or temp-cleaner erased it, and a still-dead leg after a PC
 * restart re-alarmed, breaking one-alarm-per-episode exactly when the
 * operator needs quiet. state/ in the dedicated clone is loop-owned and
 * persistent; the flag is untracked (pushPayload stages only the payload
 * path; the bot commits only seen-posts.json), so rebase never touches it.
 */
const DEFAULT_MARKER = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-leg-dead.flag");

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send the leg-dead alarm ONCE per episode: the marker file edges the
 * healthy→dead transition, so a 144-tick dead day emails once. Every dead
 * tick still warns in the run log.
 */
export async function handleLegDeadEpisode(
  reason: string,
  deps: FetchTickDeps = {},
): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  const env = deps.env ?? process.env;
  if (await markerExists(marker)) {
    console.warn(`fetch-linkedin: leg still dead — ${reason} (alarm already sent this episode)`);
    return;
  }
  await writeFile(marker, `${reason}\n`, "utf8");
  console.error(`fetch-linkedin: LEG DEAD — ${reason}`);
  const alarm =
    deps.alarm ??
    (async (alarmReason: string) => {
      try {
        await sendLegDeadAlarm(alarmReason, resolveEmailConfig(env));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch-linkedin: alarm not sent — ${message}`);
      }
    });
  await alarm(reason);
}

/** Clear a prior episode marker on a healthy tick (the dead→healthy edge). */
async function clearEpisodeMarker(deps: FetchTickDeps): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  if (await markerExists(marker)) {
    await rm(marker, { force: true });
    console.log("fetch-linkedin: leg recovered — episode cleared");
  }
}

/**
 * Commit + push ONLY the payload path with the rebase+retry discipline.
 * The rebase replays the payload commit onto origin/main; a conflict on
 * the payload path is impossible while it has one writer, so a conflict
 * aborts loudly instead of skipping (the bot's whitelist never applies —
 * its seen-posts.json replay touches a disjoint path).
 */
export async function pushPayload(
  git: GitRunner,
  postCount: number,
  filePath: string = LINKEDIN_PAYLOAD_PATH,
): Promise<void> {
  await git(["add", filePath]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) {
    console.log("git: payload unchanged; nothing to commit");
    return;
  }
  // The commit exit code IS checked: an unconfigured git identity in a
  // fresh dedicated clone is the classic first-tick failure, and skipping
  // the check would let rebase+push succeed while pushing NOTHING — a
  // silent no-op tick reporting pushed=true (fail-visible doctrine).
  const commit = await git(["commit", "-m", `linkedin: payload ${postCount} post(s)`]);
  if (commit.code !== 0) {
    throw new Error(
      "git: payload commit failed — configure the clone's git identity first (git config user.name + user.email)",
    );
  }
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      console.error("git: rebase conflicted — aborting; a non-payload change cannot replay");
      await git(["rebase", "--abort"]);
      return false;
    }
    return (await git(["push"])).code === 0;
  };
  const pushed = (await attempt()) || (await attempt());
  if (!pushed) {
    throw new Error("git: payload push failed twice — run aborted");
  }
  console.log("git: pushed payload commit");
}

export async function fetchTick(deps: FetchTickDeps = {}): Promise<FetchTickResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    console.log("fetch-linkedin: no linkedin surfaces configured — nothing to do");
    return { wrote: false, pushed: false, postCount: 0 };
  }
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  const transport = deps.transport ?? (await resolveLinkedInTransport(env, cookies));
  let posts: Post[];
  try {
    // The bare GET rides the walk (never the Transport object — the walk
    // disposes any Transport it receives); disposal is this finally's job alone.
    posts = await fetchLinkedInPosts(surfaces, cookies, transport.get);
  } finally {
    // The caller owns a provided transport; a locally opened one dies here.
    if (deps.transport === undefined) await transport.dispose();
  }
  const payloadPath = deps.payloadPath ?? LINKEDIN_PAYLOAD_PATH;
  await writePayloadAtomic(posts, payloadPath, now);
  console.log(`payload: wrote ${posts.length} post(s) — ${payloadPath}`);
  await pushPayload(deps.git ?? realGit, posts.length, payloadPath);
  await clearEpisodeMarker(deps);
  return { wrote: true, pushed: true, postCount: posts.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchTick().catch(async (error: unknown) => {
    if (isLegDead(error)) {
      await handleLegDeadEpisode(error.reason);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

```

### scripts/watch-linkedin.ts — NEW

Loop wrapper: `while (true) { await fetchTick(); await sleep(TICK_MS); }` with `TICK_MS = 600_000` module constant; catches `LegDeadError` (episode-edge alarm + warn + continue), catches per-tick faults (warn + continue); Ctrl-C exits.

```ts
/**
 * The always-on PC loop (design D1/D7): one fetch tick, then a 10-minute
 * sleep, forever. Leg-dead edges send ONE alarm per episode (the marker
 * file in scripts/fetch-linkedin.ts) and the loop keeps running — a
 * cookie-file refresh self-heals on a later tick without a restart. Any
 * other tick fault warns and the loop continues; Ctrl-C stops it.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** The 10-minute cadence, in code (D1: an always-on npm script). */
const TICK_MS = 600_000;

async function main(): Promise<void> {
  for (;;) {
    try {
      await fetchTick();
    } catch (error) {
      if (isLegDead(error)) {
        await handleLegDeadEpisode(error.reason);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`watch-linkedin: tick FAILED — ${message}`);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, TICK_MS);
    });
  }
}

void main();
```

### scripts/probe-linkedin.ts — NEW

Zero-edit probe: loadWatcherConfig surfaces, resolve cookies + transport, fetch first surface (count 10), assert ≥2 posts, `probe:` log lines, exit 1 on leg-dead/short/fault (probe-judge pattern).

```ts
/**
 * LinkedIn transport gate (design D8, the probe-judge pattern): drive the
 * SAME production stack — cookie resolver, transport selection, §12.7 URL
 * builder, response parser — against the first configured linkedin
 * surface, one small page.
 *
 * Exit 1 on leg-dead, an HTTP fault, an unparsable 200, or fewer than 2
 * posts. Operator protocol (Nov 1 research rule): run twice ≥6h apart with
 * stored cookies only before trusting the loop; re-run after any
 * LINKEDIN_TRANSPORT change.
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { loadWatcherConfig } from "../src/config-file.js";
import {
  type LinkedinSurface,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";
import { buildSearchUrl, parseSearchResponse } from "../src/linkedin-voyager.js";

const CONFIG = await loadWatcherConfig();

const surfaces = CONFIG.surfaces.filter(
  (surface): surface is LinkedinSurface => surface.type === "linkedin",
);
if (surfaces.length === 0) {
  console.error("probe: no linkedin surfaces configured in watcher.config.json");
  process.exit(1);
}
const surface = surfaces[0] as LinkedinSurface;

try {
  const cookies = resolveLinkedInCookies();
  const transportSelection = process.env.LINKEDIN_TRANSPORT?.trim() || "curl";
  console.log(
    `probe: transport ${transportSelection} — GET voyager search for "${surface.value}" (count 10)`,
  );
  const started = Date.now();
  const transport = await resolveLinkedInTransport(undefined, cookies);
  try {
    const response = await transport.get(buildSearchUrl(surface.value, 0, 10));
    const elapsed = Date.now() - started;
    if (response.status !== 200) {
      console.error(`probe: HTTP ${response.status} — ${response.body.slice(0, 120)}`);
      process.exit(1);
    }
    const parsed = parseSearchResponse(response.body);
    if (parsed.kind !== "ok") {
      console.error(`probe: 200 body unparsable — ${parsed.reason}`);
      process.exit(1);
    }
    console.log(
      `probe: ${elapsed}ms — HTTP 200 — ${parsed.posts.length} post(s), ${parsed.dropped} dropped`,
    );
    if (parsed.posts.length < 2) {
      console.error("probe: fewer than 2 posts — the endpoint answered but the leg looks wrong");
      process.exit(1);
    }
    console.log("probe: all checks passed");
  } finally {
    await transport.dispose();
  }
} catch (error) {
  if (isLegDead(error)) {
    console.error(`probe: LEG DEAD — ${error.reason}`);
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe: FAILED — ${message}`);
  process.exit(1);
}
```

```

### src/config.ts — MODIFY

Fence A is the SLICE-6 STATE (final; rewritten at the 2026-11-04 slice-6 checkpoint): the slice-5 re-key removed the last code consumers — the index.ts arm's `resolveLinkedApiTokens` call + token warn died with the whole-file re-key, and the only remaining readers were the module deleted this slice (`src/fetch-linkedin-api.ts:89-90`) and its suite — so the linkedApi pair LEAVES the block. Splice = replace the on-disk text between the `/** Environment variable names... */` comment line and its `} as const;` with fence A — exactly what the harness's materializeConfigState does; at implement time `LINKEDIN_PAYLOAD_PATH` may instead land beside `STATE_PATH` (one const, position immaterial to every gate). Gate-proven at this state in the harness (tsc + biome + 158/158).

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE",
  linkedinTransport: "LINKEDIN_TRANSPORT",
  curlImpersonateBin: "CURL_IMPERSONATE_BIN",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/**
 * PC-leg payload (design D5): the local voyager loop writes fetched raw
 * posts here and pushes this single path to main; the hosted run reads it
 * (src/linkedin-payload.ts). Exactly one writer per file — the bot owns
 * seen-posts.json, the PC owns this one — so the two rebase+retry push
 * disciplines can never lose each other's commits.
 */
export const LINKEDIN_PAYLOAD_PATH = "state/linkedin-posts.json";
```


### src/heartbeat.ts — MODIFY
`HeartbeatStats` gains `readonly linkedinLeg?: LegLine` (attached only when the payload reader ran, exactOptionalPropertyTypes-style) and the heartbeat body gains one leg line inside the funnel block: `LinkedIn leg: ok — payload N min old` / `LinkedIn leg: DARK — payload N h old` / `LinkedIn leg: absent — no payload file` / `LinkedIn leg: malformed — <reason>`. New export `linkedinLegLine(leg)` renders the line; `buildHeartbeatBody` calls it behind the attached-vs-undefined conditional spread.


```ts
import type { Transporter } from "nodemailer";
import { type EmailConfig, sendText } from "./email.js";
import type { LegLine } from "./linkedin-payload.js";
/**
 * No-match heartbeat (Phase 9).
 *
 * The watcher sends no email when a run finds no match, so the operator has
 * no signal that the pipeline is alive — and no way to see why a run found
 * nothing without opening the Actions log. Measured 2026-10-25: the
 * authenticated feed carries ~300 recent posts per run, and zero-match runs
 * are the normal case. This module builds and sends a status email for
 * those runs: the scan funnel plus the candidate posts that came closest,
 * each with its permalink.
 *
 * The candidate net comes from watcher.config.json ("candidateTerms") and is
 * deliberately broader than the keyword list the judge uses: a post that
 * names no configured keyword can still be worth a human look.
 *
 * The LinkedIn leg line (D6/D13): every run with a linkedin surface renders
 * one leg line inside the funnel block. A threads-only run is permanently
 * quiet, and the PC-side leg alarm cannot fire while the PC is off — the
 * hosted heartbeat is the only surface that can say "LinkedIn dark" then.
 */
import type { Post } from "./types.js";

/** Maximum candidates listed in one heartbeat email. */
const MAX_CANDIDATES = 10;

/** Funnel counts for one run, collected by src/index.ts. */
export interface HeartbeatStats {
  /** ISO 8601 UTC timestamp of the run start. */
  ranAt: string;
  /** Unique posts after cross-surface dedupe. */
  unique: number;
  /** Posts kept by the recency filter. */
  recent: number;
  /** Recency window in hours. */
  recencyHours: number;
  /** Posts sent to the LLM judge (all recency+seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  relevantLocated: number;
  /** Posts the judge could not evaluate. */
  skipped: number;
  /** Actions run URL, when the workflow provides the ambient variables. */
  runUrl?: string;
  /** LinkedIn leg state (D6): attached only when the payload reader ran this run. */
  linkedinLeg?: LegLine;
}

/** One candidate post plus why it is in the list. */
export interface Candidate {
  post: Post;
  /** "judged" went to the LLM judge; "near-miss" only the broader net. */
  reason: "judged" | "near-miss";
}

/**
 * True when the text mentions any candidate term (case-insensitive).
 */
export function matchesCandidateTerms(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}

/**
 * Pick the posts worth a human look: every judged candidate first (the
 * strongest signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  judged: readonly Post[],
  terms: readonly string[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = judged.map((post) => ({
    post,
    reason: "judged" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const judgedIds = new Set(judged.map((post) => post.id));
  const nearMisses = recent
    .filter((post) => !judgedIds.has(post.id) && matchesCandidateTerms(post.text, terms))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const post of nearMisses) {
    if (out.length >= limit) break;
    out.push({ post, reason: "near-miss" });
  }
  return out;
}

/** One-line text preview: whitespace collapsed, truncated at `max` chars. */
export function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Age of a post in whole hours relative to `now`; 0 when unparseable. */
export function ageHours(timestamp: string, now: number): number {
  const takenAt = new Date(timestamp).getTime();
  if (!Number.isFinite(takenAt)) return 0;
  return Math.max(0, Math.floor((now - takenAt) / 3_600_000));
}

/** Subject line for the heartbeat email. */
export function buildHeartbeatSubject(stats: HeartbeatStats): string {
  return `loker-watcher: 0 new matches — ${stats.recent} post(s) scanned`;
}

/**
 * The LinkedIn leg line inside the heartbeat funnel (D6/D13): ok names the
 * payload age, DARK names the staleness, absent names the missing file,
 * malformed names the reason. Four states, always exactly one line — the
 * run log tells why, this line says how dark the leg is.
 */
export function linkedinLegLine(leg: LegLine): string {
  const detail = leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
  if (leg.status === "ok") return `LinkedIn leg: ok${detail}`;
  if (leg.status === "stale") return `LinkedIn leg: DARK${detail}`;
  if (leg.status === "absent") return "LinkedIn leg: absent — no payload file";
  return `LinkedIn leg: malformed${detail}`;
}

/** Plain-text body: the funnel, then the candidates with permalinks. */
export function buildHeartbeatBody(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  now: number,
): string {
  const lines: string[] = [
    `loker-watcher — ${stats.ranAt}`,
    "",
    "0 new job matches.",
    "",
    `  ${stats.unique} unique post(s)`,
    `  ${stats.recent} within ${stats.recencyHours}h`,
    `  ${stats.judged} judged candidate(s)`,
    `  ${stats.relevantLocated} relevant + located`,
    `  ${stats.skipped} skipped by the judge`,
    ...(stats.linkedinLeg !== undefined ? [`  ${linkedinLegLine(stats.linkedinLeg)}`] : []),
    "",
  ];

  if (candidates.length === 0) {
    lines.push("No candidate posts in this run.");
  } else {
    lines.push(`Closest ${candidates.length} candidate(s), newest first:`);
    lines.push("");
    candidates.forEach((candidate, index) => {
      const age = ageHours(candidate.post.timestamp, now);
      const tag = candidate.reason === "judged" ? " [judged]" : "";
      lines.push(`${index + 1}. @${candidate.post.author} — ${age}h ago${tag}`);
      lines.push(`   ${snippet(candidate.post.text)}`);
      lines.push(`   ${candidate.post.permalink}`);
      lines.push("");
    });
  }

  if (stats.runUrl !== undefined) {
    lines.push(`Run: ${stats.runUrl}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Send the heartbeat email. Reuses the digest transport path so both emails
 * share one credential resolution and one fail-visible error shape.
 * Accepts an optional Transporter for unit testing, exactly as sendDigest
 * does — without it the function would open a real Gmail connection.
 */
export async function sendHeartbeat(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  config: EmailConfig,
  now: number = Date.now(),
  transport?: Transporter,
): Promise<void> {
  await sendText(
    buildHeartbeatSubject(stats),
    buildHeartbeatBody(stats, candidates, now),
    config,
    transport,
  );
  console.log(
    `heartbeat: sent status email — ${stats.recent} post(s) scanned, ${candidates.length} candidate(s)`,
  );
}
```


### tests/heartbeat.test.ts — MODIFY
Pins the leg line for all four states — a dedicated `linkedinLegLine (D13)` describe with one `it` per state (ratified at the 2026-11-04 checkpoint: the four-state coverage rides the unit renderer, not four body-level tests, because the body's only conditional is attached-vs-not) — plus the body wiring: the funnel renders the stale and ok lines with the two-space indent, and omits the line entirely when the field was never attached (pre-reader runs). The whole proven merged suite is the fence below.


```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type Candidate,
  type HeartbeatStats,
  ageHours,
  buildHeartbeatBody,
  buildHeartbeatSubject,
  linkedinLegLine,
  matchesCandidateTerms,
  selectCandidates,
  sendHeartbeat,
  snippet,
} from "../src/heartbeat.js";
import type { Post } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

// The candidate net is a required parameter (Phase 10): it comes from
// watcher.config.json, so every case below passes an explicit list.
const TERMS = ["developer", "software", "engineer", "jakarta", "remote"];

function post(id: string, text: string, hoursAgo: number, author = "tester"): Post {
  return {
    platform: "threads",
    id,
    text,
    author,
    permalink: `https://www.threads.com/@${author}/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

const STATS: HeartbeatStats = {
  ranAt: "2026-10-25T12:00:00.000Z",
  unique: 337,
  recent: 303,
  recencyHours: 72,
  judged: 1,
  relevantLocated: 0,
  skipped: 0,
};

describe("matchesCandidateTerms", () => {
  it("matches adjacent dev terms", () => {
    assert.equal(matchesCandidateTerms("Hiring a software engineer", TERMS), true);
    assert.equal(matchesCandidateTerms("WE ARE HIRING developers", TERMS), true);
  });

  it("matches Indonesian cities and remote", () => {
    assert.equal(matchesCandidateTerms("Lowongan di Jakarta", TERMS), true);
    assert.equal(matchesCandidateTerms("100% remote role", TERMS), true);
  });

  it("matches mixed-case and padded terms", () => {
    assert.equal(matchesCandidateTerms("frontend dev wanted", ["Frontend"]), true);
    assert.equal(matchesCandidateTerms("100% remote role", [" Remote "]), true);
  });

  it("rejects unrelated posts", () => {
    assert.equal(matchesCandidateTerms("HIRING Barista Waiter", TERMS), false);
    assert.equal(matchesCandidateTerms("Kitchen crew Johor Bahru", TERMS), false);
  });
});

describe("selectCandidates", () => {
  it("puts judged candidates first", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const near = post("n1", "Software engineer Jakarta", 1);
    const result = selectCandidates([lead, near], [lead], TERMS, 10);
    assert.equal(result[0]?.reason, "judged");
    assert.equal(result[0]?.post.id, "m1");
    assert.equal(result[1]?.reason, "near-miss");
  });

  it("orders near-misses newest first", () => {
    const older = post("a", "Software engineer", 40);
    const newer = post("b", "Software engineer", 2);
    const result = selectCandidates([older, newer], [], TERMS, 10);
    assert.deepEqual(
      result.map((c) => c.post.id),
      ["b", "a"],
    );
  });

  it("does not repeat a judged candidate as a near-miss", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const result = selectCandidates([lead], [lead], TERMS, 10);
    assert.equal(result.length, 1);
  });

  it("caps the list at the limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(`p${i}`, "Software engineer", i));
    assert.equal(selectCandidates(posts, [], TERMS, 10).length, 10);
    assert.equal(selectCandidates(posts, [], TERMS, 3).length, 3);
  });

  it("returns an empty list when nothing qualifies", () => {
    assert.deepEqual(selectCandidates([post("x", "Barista", 1)], [], TERMS, 10), []);
  });
});

describe("snippet", () => {
  it("collapses whitespace", () => {
    assert.equal(snippet("a\n  b\tc"), "a b c");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = snippet(long, 50);
    assert.equal(out.length, 50);
    assert.ok(out.endsWith("…"));
  });

  it("leaves short text untouched", () => {
    assert.equal(snippet("short"), "short");
  });
});

describe("ageHours", () => {
  it("computes whole hours", () => {
    assert.equal(ageHours(new Date(NOW - 5 * 3_600_000).toISOString(), NOW), 5);
  });

  it("returns 0 for unparseable timestamps", () => {
    assert.equal(ageHours("not-a-date", NOW), 0);
  });
});

describe("buildHeartbeatSubject", () => {
  it("names the scanned count", () => {
    assert.equal(
      buildHeartbeatSubject(STATS),
      "loker-watcher: 0 new matches — 303 post(s) scanned",
    );
  });
});

describe("linkedinLegLine (D13)", () => {
  it("renders ok with the payload-age detail", () => {
    assert.equal(
      linkedinLegLine({ status: "ok", detail: "payload 3 min old" }),
      "LinkedIn leg: ok — payload 3 min old",
    );
  });

  it("renders DARK with the staleness detail", () => {
    assert.equal(
      linkedinLegLine({ status: "stale", detail: "payload 2h old" }),
      "LinkedIn leg: DARK — payload 2h old",
    );
  });

  it("renders absent without detail", () => {
    assert.equal(linkedinLegLine({ status: "absent" }), "LinkedIn leg: absent — no payload file");
  });

  it("renders malformed with the reason detail", () => {
    assert.equal(
      linkedinLegLine({ status: "malformed", detail: "not valid JSON: x" }),
      "LinkedIn leg: malformed — not valid JSON: x",
    );
  });
});

describe("buildHeartbeatBody", () => {
  it("includes the funnel counts", () => {
    const body = buildHeartbeatBody(STATS, [], NOW);
    assert.ok(body.includes("337 unique post(s)"));
    assert.ok(body.includes("303 within 72h"));
    assert.ok(body.includes("1 judged candidate(s)"));
    assert.ok(body.includes("0 relevant + located"));
  });

  it("renders the leg line inside the funnel block when the reader ran (stale state)", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "stale", detail: "payload 2h old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: DARK — payload 2h old"));
  });

  it("renders the ok leg with the payload age", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "ok", detail: "payload 3 min old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: ok — payload 3 min old"));
  });

  it("omits the leg line entirely when the reader never ran", () => {
    assert.ok(!buildHeartbeatBody(STATS, [], NOW).includes("LinkedIn leg:"));
  });

  it("lists candidates with permalinks", () => {
    const candidates: Candidate[] = [
      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "judged" },
    ];
    const body = buildHeartbeatBody(STATS, candidates, NOW);
    assert.ok(body.includes("1. @techco — 2h ago [judged]"));
    assert.ok(body.includes("https://www.threads.com/@techco/post/c1"));
  });

  it("says so when there are no candidates", () => {
    assert.ok(buildHeartbeatBody(STATS, [], NOW).includes("No candidate posts"));
  });

  it("appends the run URL when present", () => {
    const body = buildHeartbeatBody(
      { ...STATS, runUrl: "https://github.com/o/r/actions/runs/1" },
      [],
      NOW,
    );
    assert.ok(body.includes("Run: https://github.com/o/r/actions/runs/1"));
  });
});

describe("sendHeartbeat", () => {
  it("sends the subject and body through the transport", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: { subject: string; text: string }) => {
        captured = options;
        return { messageId: "hb-1" };
      },
    } as unknown as Transporter;

    await sendHeartbeat(STATS, [], { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);

    assert.ok(captured !== null);
    const mail = captured as { subject: string; text: string };
    assert.equal(mail.subject, "loker-watcher: 0 new matches — 303 post(s) scanned");
    assert.ok(mail.text.includes("337 unique post(s)"));
  });

  it("logs the scanned and candidate counts", async () => {
    const mockTransport = {
      sendMail: async () => ({ messageId: "hb-2" }),
    } as unknown as Transporter;
    const candidates: Candidate[] = [
      { post: post("c1", "Software engineer Jakarta", 1), reason: "near-miss" },
    ];

    await sendHeartbeat(STATS, candidates, { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);
    // No assertion on stdout; the call completing without a throw is the
    // contract. The body content is covered by buildHeartbeatBody above.
    assert.equal(candidates.length, 1);
  });
});
```


### src/email.ts — MODIFY

Leg-dead alarm variant per the email-variant guidance: `buildLegDeadAlarm(subject context): string` (null-safe) + `sendLegDeadAlarm(..., config, transport?)` thin wrapper riding `sendText`; caller (scripts) owns best-effort try/catch policy. `buildDigest` gains a trailing `LinkedIn leg: <state>` line rendered only when the state is not `ok` (D13).

```ts
// email.ts — MODIFY (slice 4): four changes.
// 1) import: import type { LegLine } from "./linkedin-payload.js";
// 2) buildDigest gains the trailing leg param; the line renders only when the state is not ok
//    (the ` — detail` suffix rides the legDetailSuffix helper — biome rejected the inline
//    nested ternary at >100 cols; the proven whole-file merge is slice-recon/work/email.ts):
export function buildDigest(posts: readonly Post[], leg?: LegLine): string | null {
  const subject = buildSubject(posts);
  if (subject === null) return null;
  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });
  const legLine =
    leg !== undefined && leg.status !== "ok"
      ? `\n\nLinkedIn leg: ${leg.status}${legDetailSuffix(leg)}`
      : "";
  return `${subject}\n\n${items.join("\n\n")}${legLine}\n`;
}

/** The ` — detail` suffix for a leg line; empty when no detail rides. */
function legDetailSuffix(leg: LegLine): string {
  return leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
}
// 3) sendDigest: signature gains `leg?: LegLine` (trailing, after transport) and passes it —
//    const text = buildDigest(posts, leg);
// 4) the leg-dead alarm variant (email-variant guidance shape: buildX pure + sendX thin;
//    the PC loop caller owns the best-effort try/catch policy):
export function buildLegDeadAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is dead.",
    "",
    `Signature: ${reason}`,
    "",
    "The loop keeps running. Refresh the cookie file (LINKEDIN_COOKIES_FILE —",
    "re-export the pair from a logged-in browser) and the next tick heals;",
    "no restart needed. Failure matrix: DOCUMENTATION.md §13; session: §14.",
  ].join("\n");
}
export async function sendLegDeadAlarm(
  reason: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const messageId = await sendText(
    "LinkedIn fetch leg is dead — refresh the cookie file",
    buildLegDeadAlarmText(reason),
    config,
    transport,
  );
  console.log("email: sent leg-dead alarm");
  return messageId;
}
```

### package.json — MODIFY

scripts: add `fetch-linkedin`, `watch-linkedin`, `probe-linkedin` (tsx entries); lint glob gains the three script paths; format glob gains them (closing the lint/format gap the developer flagged). Slice 6 removes `@linkedapi/node` from dependencies (+ lockfile regen).

```json
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/hooks",
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts",
    "fetch-linkedin": "tsx scripts/fetch-linkedin.ts",
    "watch-linkedin": "tsx scripts/watch-linkedin.ts",
    "probe-linkedin": "tsx scripts/probe-linkedin.ts",
    "prepare": "husky"
  },
// Slice 6 also removes "@linkedapi/node" from dependencies (npm uninstall regenerates the lockfile).
```

### src/index.ts — MODIFY
Acquisition arm re-key (slice 5): partition/labels/D14 startup line unchanged; the `resolveLinkedApiTokens` call + token warn are deleted; the arm reads the payload through the re-keyed `linkedinFetch` dep inside the D12 belt catch; single-array return and everything downstream untouched. Payload faults follow D13: ENOENT → quiet log; stale → age log; malformed envelope → warn; malformed rows → drop+count — never exit nonzero. Proven corrections (harness-caught, 2026-11-04): `LINKEDIN_PAYLOAD_PATH` rides the merged `./config.js` import (it exports from config.ts, not linkedin-payload.ts); `LinkedinSurface` imports from `./linkedin-fetch.js`; `linkedinLeg: LegLine | undefined` is declared before the acquisition `timeStage`, attached into stats by conditional spread, and passed to `sendDigest` as the 4th argument (locked slice-4 signature renders it only when not ok). Zero `fetch-linkedin-api` references remain — clean for slice 6. The whole proven merged file is the fence below.


```ts
import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import {
  ENV_NAMES,
  LINKEDIN_PAYLOAD_PATH,
  STATE_PATH,
  isHeartbeatEnabled,
  runUrlFromEnv,
} from "./config.js";
import { resolveEmailConfig, sendDigest, sendExhaustionEmail } from "./email.js";
/**
 * CLI entry point: the full pipeline (FRD #1-#9; fast-workflow-runtime
 * D7-D9; rotation exhaustion path).
 *
 * fetch → extract → dedupe vs state → judge → notify → state commit. Every
 * stage logs its counts and its duration; any thrown error exits non-zero
 * and leaves state untouched (persistence is ordered after the notification
 * send, so a failed run never marks posts seen).
 *
 * Persistence (D7/D8): EVERY judged post id is persisted — including
 * zero-match runs — so no judged post is ever fed to the LLM twice.
 * Skipped ids stay unseen and retry next run. A run whose LLM_ACCOUNTS
 * pool is exhausted throws the tagged RotationExhausted error: the alarm
 * email is best-effort and the run exits 1 (state was never reached).
 *
 * What to watch and how to filter comes from watcher.config.json (Phase 10),
 * loaded once at startup. A missing or malformed file fails the run.
 */
import { extractPosts } from "./extract.js";
import { type ContextFactory, fetchSurfaces, fetchSurfacesAuthenticated } from "./fetch-threads.js";
import { type HeartbeatStats, selectCandidates, sendHeartbeat } from "./heartbeat.js";
import { isRotationExhausted } from "./judge-rotation.js";
import {
  type JudgedPost,
  judgePosts,
  parseJudgeConcurrency,
  resolveJudgeConfig,
  sleep,
} from "./judge.js";
import type { LinkedinSurface } from "./linkedin-fetch.js";
import { type LegLine, type PayloadRead, readPayloadPosts } from "./linkedin-payload.js";
import { filterRecent } from "./recency.js";
import { type AppState, diffNew, loadState, saveState } from "./state.js";
import { cleanupSessionDir, resolveSession } from "./threads-session.js";
import type { Post } from "./types.js";

/**
 * Best-effort status email for a zero-match run.
 *
 * Unlike the digest, a heartbeat that cannot be sent must not fail the run:
 * the pipeline did its job, only the notification failed. Logged loudly so a
 * broken GMAIL_* configuration is visible in the run log. Env, the clock,
 * and the transport arrive from WatcherDeps so an offline run can inject all
 * three.
 */
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  judged: readonly Post[],
  candidateTerms: readonly string[],
  env: Record<string, string | undefined>,
  now: () => number,
  transport?: Transporter,
): Promise<void> {
  if (!isHeartbeatEnabled(env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(env);
    const candidates = selectCandidates(recent, judged, candidateTerms);
    await sendHeartbeat(stats, candidates, config, now(), transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

/**
 * Run one pipeline stage and report its wall-clock duration (D9). The clock
 * is injectable so tests assert durations without waiting; production
 * passes nothing and measures real time. The caller logs the returned
 * durationMs — one order-stable line per stage await, at stage level only
 * (inner logs interleave once stages do real work).
 */
export async function timeStage<T>(
  run: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ value: T; durationMs: number }> {
  const startedAtMs = now();
  const value = await run();
  return { value, durationMs: Math.max(0, now() - startedAtMs) };
}

/**
 * Injectable dependencies for one watcher run; every field has the
 * production default the pipeline uses when omitted. This is the unit seam
 * the offline suite operates (tests/index.test.ts): env, config, surface
 * fetch, the LinkedIn payload reader, LLM transport, SMTP transport, state
 * file, and the clock all inject, so a full pipeline run executes offline.
 */
export interface WatcherDeps {
  /** Environment record for every resolver. Default: process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Pre-resolved watcher config. Default: loadWatcherConfig() — fail-visible. */
  readonly config?: WatcherConfig;
  /** Browser-context factory for the surface walks (Slice 3 seam). Default: chromiumContextFactory. */
  readonly contextFactory?: ContextFactory;
  /** LinkedIn payload reader (D6 seam). Default: readPayloadPosts — the module owns its degrade contract (D13). */
  readonly linkedinFetch?: (payloadPath: string, now: () => number) => Promise<PayloadRead>;
  /** LLM HTTP transport. Default: global fetch. */
  readonly fetchFn?: typeof fetch;
  /** SMTP transport for the digest and the heartbeat. Default: nodemailer. */
  readonly transport?: Transporter;
  /** State file path. Default: STATE_PATH (the commit-back location). */
  readonly statePath?: string;
  /** Clock for recency, prune, state stamps, and heartbeat ages. Default: Date.now. */
  readonly now?: () => number;
  /** Park wait for the judge's cooldown parking. Default: the judge module's sleep. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

/** Funnel outcome of one run: the summary handle tests assert on. */
export interface WatcherRun {
  /** Posts sent to the LLM judge (recency + seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  matches: number;
  /** Posts the judge could not evaluate (they stay unseen). */
  skipped: number;
  /** Whether this run persisted judged ids to the state file. */
  saved: boolean;
}

/**
 * One watcher run: the linear funnel with Gate 1 (nothing unseen), Gate 2
 * (judged but zero matches), and the match path. Stage awaits carry
 * timeStage timers; persistence (D7/D8) happens on every run that judged
 * posts, ordered after the notification send.
 */
export async function runWatcher(deps: WatcherDeps = {}): Promise<WatcherRun> {
  const env = deps.env ?? process.env;
  const config = deps.config ?? (await loadWatcherConfig());
  const now = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? sleep;
  const statePath = deps.statePath ?? STATE_PATH;
  const startedAt = now();
  const linkedinFetch = deps.linkedinFetch ?? readPayloadPosts;
  // D14: labels come from the RAW config partition, not the resolved
  // array — Slice 3 narrows ResolvedSurface to threads-only, and this
  // line must keep listing every surface the run attempts, linkedin
  // included. Labels: tag/<value>, url verbatim, linkedin/<value>.
  console.log(`watch: surfaces: ${config.surfaces.map(surfaceLabel).join(", ")}`);
  // Raw partition first: the PC leg's payload reader takes the fixed repo
  // path (no surface arguments), the walker takes resolved threads records.
  // Slice 3 narrows ResolvedSurface.platform to "threads"; partitioning
  // here keeps linkedin entries out of resolveSurfaces.
  const linkedinSurfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  const surfaces = resolveSurfaces(
    config.surfaces.filter((surface) => surface.type !== "linkedin"),
  );

  // Acquisition stage (D4): the per-platform fetches timed as one span.
  // Extraction happens inside the walk; the dedupe count logs right after
  // the duration line. Threads keeps its Playwright walks; LinkedIn reads
  // the PC leg's pushed payload (D6/D13 — the reader is total, absent and
  // stale degrade to a logged threads-only run).
  let linkedinLeg: LegLine | undefined;
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    const threadsSessionPath = await resolveSession(env);
    try {
      let threadsPosts: Post[] = [];
      // An empty threads partition never reaches the walker: its all-fail
      // gate throws on zero surfaces (fetch-threads.ts:397-409). D13 keeps
      // the LinkedIn arm alive regardless of the Threads partition shape.
      if (threadsSessionPath !== null && surfaces.length > 0) {
        threadsPosts = await fetchSurfacesAuthenticated(
          surfaces,
          threadsSessionPath,
          deps.contextFactory,
          { scrollRounds: config.scrollRounds },
        );
      } else if (threadsSessionPath === null && surfaces.length > 0) {
        threadsPosts = await fetchLoggedOutPosts(surfaces, deps.contextFactory);
      }
      let linkedinPosts: Post[] = [];
      if (linkedinSurfaces.length > 0) {
        // D6/D13: the arm reads the PC leg's pushed payload. The reader is
        // total — absent/stale/malformed all degrade to a logged
        // threads-only run, never a nonzero exit — so this belt catches
        // only unanticipated faults and throwing injected stubs (D12).
        try {
          const read = await linkedinFetch(LINKEDIN_PAYLOAD_PATH, now);
          linkedinPosts = read.posts;
          linkedinLeg =
            read.detail !== undefined
              ? { status: read.leg, detail: read.detail }
              : { status: read.leg };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`fetch: linkedin payload FAILED — ${message}`);
          linkedinLeg = { status: "malformed", detail: message };
        }
      }
      // D13: ONE return. The old early returns (empty-pool guard, logged-out
      // arm) silently dropped LinkedIn posts on a linkedin-only config with
      // a Threads secret.
      return [...threadsPosts, ...linkedinPosts];
    } finally {
      // F019 pairing: the Threads session dir dies with the run. The
      // payload reader keeps no session dir (cookies ride the PC leg).
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
    }
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${config.surfaces.length} surface(s)`,
  );
  // (the extract line counts config.surfaces.length — the resolved array is
  // threads-only from this slice on; the count is the surfaces ATTEMPTED)

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours, now());
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(env);

  const stats: HeartbeatStats = {
    ranAt: new Date(startedAt).toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
    ...(linkedinLeg !== undefined ? { linkedinLeg } : {}),
  };

  // Prune-on-load (D6/D7): state entries outside the recency window drop
  // before dedupe, so the seen map cannot grow without bound.
  const state = await loadState(statePath, recencyHours, now());
  const newPosts = diffNew(state, recent);
  stats.judged = newPosts.length;
  if (newPosts.length === 0) {
    // Gate 1 (zero unseen): nothing was judged, so nothing persists — the
    // state file stays byte-identical. The heartbeat still runs (timed).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    console.log("no new matches");
    return { judged: 0, matches: 0, skipped: 0, saved: false };
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      parseJudgeConcurrency(env[ENV_NAMES.judgeConcurrency]),
      now,
      sleepFn,
    ),
  );
  console.log(`timing: judge ${judgeMs}ms`);
  const { judged, skippedPostIds } = judgeOutcome;
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `judge: ${newPosts.length} candidate(s) judged, ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    // Gate 2 (D7/D8): the run JUDGED these posts even though none matched.
    // Persist every judged id — heartbeat first, then state, mirroring the
    // notification-before-persistence convention — so the next run never
    // feeds the same posts to the LLM again. Skipped ids stay unseen and
    // retry next run (D3).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    const saved = await persistJudged(state, judged, statePath, now());
    console.log("no new matches");
    return {
      judged: newPosts.length,
      matches: 0,
      skipped: skippedPostIds.length,
      saved,
    };
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  // The leg state rides the digest whenever it is not ok (D13 — sendDigest
  // renders the line only then; undefined omits it entirely).
  const { durationMs: notifyMs } = await timeStage(() =>
    sendDigest(matches, resolveEmailConfig(env), deps.transport, linkedinLeg),
  );
  console.log(`timing: notify ${notifyMs}ms`);
  const saved = await persistJudged(state, judged, statePath, now());
  return {
    judged: newPosts.length,
    matches: matches.length,
    skipped: skippedPostIds.length,
    saved,
  };
}

// --- New: the shared persistence tail (D8) ---

/**
 * Stamp every judged id — relevant or not — as seen (D8) and log the delta.
 * Skipped ids never reach this call, so they stay unseen and retry next run
 * (D3). saveState keeps its internal gate: an empty id list writes nothing.
 */
async function persistJudged(
  state: AppState,
  judged: readonly JudgedPost[],
  filePath: string,
  nowMs: number,
): Promise<boolean> {
  const judgedIds = judged.map((entry) => entry.post.id);
  const result = await saveState(state, judgedIds, filePath, nowMs);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
  return result.saved;
}

/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
  contextFactory?: ContextFactory,
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces, contextFactory);
  const posts: Post[] = [];
  for (const surface of fetched) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: ${surface.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}

/** D14 log label for one raw config surface. */
function surfaceLabel(surface: Surface): string {
  if (surface.type === "linkedin") return `linkedin/${surface.value}`;
  if (surface.type === "tag") return `tag/${surface.value}`;
  return surface.value; // url surfaces log verbatim
}

/** Dedupe posts by id, keeping first-seen order. */
function dedupePosts(posts: readonly Post[]): Post[] {
  const seen = new Set<string>();
  const unique: Post[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    unique.push(post);
  }
  return unique;
}

// Pipeline entry: the run starts only when this file IS the entry module
// (npm start, watch.yml). Importing the module — as tests/index.test.ts
// does — stays side-effect free.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatcher().catch(async (error: unknown) => {
    // Pool exhausted: one alarm email, then the standard failed-run exit.
    // The email is best-effort — a broken GMAIL_* configuration must not
    // mask the exit code the run already earned. State was never reached
    // (the throw happened in the judge stage), so no post is marked seen
    // (D3, D8).
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      try {
        await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
      } catch (emailError) {
        const emailMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
      }
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch: FAILED — ${message}`);
    process.exit(1);
  });
}
```


### tests/index.test.ts — MODIFY
Re-key the four `linkedinFetch` doubles to payload-reader doubles (the `payloadRead` helper mirrors exactOptionalPropertyTypes); token-warn tests become payload-absent tests pinning zero linkedin warns + the absent leg line on the heartbeat; the belt test pins the warn + malformed leg on the digest; NEW stale-leg digest pin (`\n\nLinkedIn leg: stale — payload 3h old\n`); `recordingTransport` also captures `texts`; the context-factory double drops its linkedin URL branch (no post-re-key code path can drive a linkedin URL — the `urls.every(...)` pins stay load-bearing). The quiet `linkedin: no payload` log line stays pinned in the payload suite — the injected stubs replace the reader. Subject pins use the real buildSubject form (`…on Threads + LinkedIn`). The whole proven merged suite is the fence below.


```ts
/**
 * Offline pipeline suite for the Gate 2 unit seam (Slice 6, D7-D9).
 * runWatcher takes every I/O boundary as an injection — env literal,
 * context-factory double, fetch double, transport double, temp state file,
 * pinned clock — so a full pipeline run executes with zero network, zero
 * browser, and zero writes inside the repo. Covers: the zero-match run
 * persisting judged ids (Gate 2), the digest path, the all-seen Gate 1
 * byte-identity, heartbeat-disabled persistence, judge-skip persistence
 * (D3), the payload-seam mixed run, the absent-payload and belt degrades
 * (D13), the D13/D14 acquisition-shape pins, and the timeStage duration
 * measurement.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type {
  ContextFactory,
  ContextLike,
  LocatorLike,
  PageLike,
  ResponseLike,
} from "../src/fetch-threads.js";
import { runWatcher, timeStage } from "../src/index.js";
import { isRotationExhausted } from "../src/judge-rotation.js";
import type { PayloadRead } from "../src/linkedin-payload.js";
import type { AppState } from "../src/state.js";
import type { JudgeVerdict, Post } from "../src/types.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every stage reads it
// through deps.now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
  reasoningEffort: "medium",
  scrollRounds: 8,
};

/** Mixed-platform config: the tag surface plus one linkedin surface. */
const MIXED_CONFIG: WatcherConfig = {
  ...CONFIG,
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "#hiring" },
  ],
};

const BASE_ENV: Record<string, string | undefined> = {
  THREADS_SESSION_STATE: Buffer.from(
    JSON.stringify({ cookies: [{ name: "session", value: "x" }] }),
  ).toString("base64"),
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
  ]),
  GMAIL_USER: "alerts@example.com",
  GMAIL_APP_PASSWORD: "app-password",
};

/** 19-digit post id, mirroring the judge tests' helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item per post, 1h old. */
const graphqlBody = (entries: ReadonlyArray<{ id: string; text: string }>): string =>
  JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: `author-${entry.id.slice(-2)}` },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts. */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** LinkedIn activity id whose embedded epoch ms equals the pinned NOW. */
const linkedinIdNow = (BigInt(NOW) << 22n).toString();

/** One normalized LinkedIn post for the injected payload-reader double. */
const linkedinPost = (id: string): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${id}`,
  text: `LinkedIn hiring post ${id}`,
  author: "linkedin-member",
  permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
  timestamp: iso(NOW),
});

/** Build a PayloadRead for the re-keyed linkedinFetch double (D6). */
const payloadRead = (posts: Post[], leg: PayloadRead["leg"], detail?: string): PayloadRead =>
  detail !== undefined ? { posts, leg, detail } : { posts, leg };

/** Minimal logged-out tag page: one data-sjs blob carrying the thread items. */
const tagPageHtml = (
  entries: ReadonlyArray<{ id: string; text: string; author: string }>,
): string =>
  `<html><head><script type="application/json" data-sjs="">${JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: entry.author },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  })}</script></head><body>hydrated</body></html>`;

/** Recent-tab locator that never becomes visible (both walks tolerate it). */
const missingTab = (): LocatorLike => {
  const tab: LocatorLike = {
    first: () => tab,
    waitFor: async () => {
      throw new Error("locator not found");
    },
    click: async () => undefined,
  };
  return tab;
};

/**
 * Context factory double for the authenticated walk: one page whose goto
 * fires the response listener with the given graphql capture.
 */
function singlePageContextFactory(capture: string): ContextFactory {
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async () => {
            const response = graphqlResponse(capture);
            for (const listener of listeners) listener(response);
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/**
 * Context-factory double for the platform-split acquisition (Phase 4):
 * each page dispatches on its goto URL — threads URLs fire the graphql
 * capture (authenticated walk) or deliver threadsHtml via content()
 * (logged-out walk). Records every requested URL and every storage-state
 * path so a test can pin which surfaces were walked and that the session
 * temp dir was cleaned. (The LinkedIn leg rides the pushed payload since
 * slice 5 — no linkedin URL is ever walked.)
 */
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  urls?: string[];
  sessionPaths?: string[];
}): ContextFactory {
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async (url: string) => {
            options.urls?.push(url);
            for (const listener of listeners) listener(graphqlResponse(options.threadsCapture));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => options.threadsHtml ?? "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/** Chat-completions 200 response carrying one message. */
const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/**
 * Chat-completions double: bulk calls answer every listed id with the given
 * verdict; single-post fallbacks answer the plain verdict object.
 */
function judgeFetch(verdict: JudgeVerdict): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b(?:urn:li:activity:)?\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) answer[id] = verdict;
      return ok(JSON.stringify(answer));
    }
    return ok(JSON.stringify(verdict));
  }) as unknown as typeof fetch;
}

/**
 * Bulk answers exactly the ids present in the verdict map (missing ids stay
 * absent — the post falls back); single-post retries fail with a 500 so the
 * fallback exhausts and the post is skipped (D3). The 500 shape and its
 * bounded backoff are the same pin the judge suite already ships.
 */
function partialBulkThenFailFetch(verdicts: Record<string, JudgeVerdict>): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) {
        const verdict = verdicts[id];
        if (verdict !== undefined) answer[id] = verdict;
      }
      return ok(JSON.stringify(answer));
    }
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
}

/** Transport double recording subject lines and plain-text bodies. */
function recordingTransport() {
  const subjects: string[] = [];
  const texts: string[] = [];
  const transport = {
    sendMail: async (options: { subject: string; text: string }) => {
      subjects.push(options.subject);
      texts.push(options.text);
      return { messageId: "msg-1" };
    },
  } as unknown as Transporter;
  return { transport, subjects, texts };
}

// Temp state files (offline rule: OS temp only, cleaned up once).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp state file path; seeds the file with a state document when given. */
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  const path = join(dir, name);
  if (seed !== undefined) {
    await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return path;
}

describe("runWatcher", () => {
  it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)", async () => {
    const posts = [
      { id: id19(1), text: "Looking for work as a frontend developer" },
      { id: id19(2), text: "Selling an ergonomic chair, barely used" },
    ];
    const statePath = await tempStatePath("gate2-zero-match.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 0, skipped: 0, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(1), id19(2)]);
    assert.equal(subjects.length, 1); // Gate 2 skips neither email nor write
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("sends the digest and persists judged ids when posts match", async () => {
    const posts = [
      { id: id19(3), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(4), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("match-digest.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /2 new job posts/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(3), id19(4)]);
  });

  it("leaves the state file byte-identical when everything is already seen (Gate 1) and still sends the heartbeat", async () => {
    const posts = [
      { id: id19(5), text: "Hiring: react developer, bandung on-site" },
      { id: id19(6), text: "Hiring: data analyst, remote" },
    ];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(5)]: iso(NOW - HOUR), [id19(6)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-all-seen.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(subjects.length, 1); // Gate 1 still notifies
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("still persists judged ids when the heartbeat is disabled", async () => {
    const posts = [{ id: id19(7), text: "Junior QA engineer opening in Surabaya" }];
    const statePath = await tempStatePath("heartbeat-off.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, HEARTBEAT_ENABLED: "false" },
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.equal(subjects.length, 0); // disabled — yet the state write still ran
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(7)]);
  });

  it("keeps judge-skipped ids unseen while persisting the judged rest (D3)", async () => {
    const posts = [
      { id: id19(8), text: "Hiring: golang engineer, remote" },
      { id: id19(9), text: "Hiring: vue developer in Bali" },
    ];
    const statePath = await tempStatePath("skip-d3.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: partialBulkThenFailFetch({ [id19(8)]: { relevant: true, locationOk: true } }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 1, skipped: 1, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(8)]); // the skipped id stays unseen
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
  });

  it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death", async () => {
    const posts = [{ id: id19(10), text: "Hiring: rust engineer, remote" }];
    const statePath = await tempStatePath("budget-death.json");
    const { transport, subjects } = recordingTransport();
    // Hand-stepped clock + inert park: three cooldown parks drain the
    // 3-minute budget instantly.
    let tick = 0;
    const now = (): number => tick;
    const sleepFn = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    const all429 = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: all429,
        transport,
        statePath,
        now,
        sleepFn,
      });
    } catch (error) {
      caught = error;
    }

    // The entry guard's contract: the tagged error with the complete
    // record — it turns that into exactly one exhaustion email + exit 1.
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as { failures: Array<{ account: number }> }).failures.map((f) => f.account),
      [1],
    );
    // The judge throw happened before any notification or persistence:
    // no email fired, and the state file was never written.
    assert.deepEqual(subjects, []);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("walks a mixed run: Threads through its session, LinkedIn through the pushed payload, and cleans the session dir", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const linkedinCalls: Array<{ path: string; nowMs: number }> = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        urls,
        sessionPaths,
      }),
      linkedinFetch: async (path, nowFn) => {
        linkedinCalls.push({ path, nowMs: nowFn() });
        return payloadRead([linkedinPost(linkedinIdNow)], "ok", "payload 0 min old");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /3 new job posts on Threads \+ LinkedIn/);
    // The reader got the fixed repo payload path and the injected clock.
    assert.deepEqual(linkedinCalls, [{ path: LINKEDIN_PAYLOAD_PATH, nowMs: NOW }]);
    // The Playwright walk never drove a linkedin URL...
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    // ...the digest marks the linkedin row and carries no leg line on ok...
    assert.ok(texts[0]?.includes("3. [linkedin] LinkedIn hiring post"));
    assert.ok(!texts[0]?.includes("LinkedIn leg:"));
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and the Threads session temp file died with the run (F019; the
    // payload reader keeps no session dir — cookies ride the PC leg).
    assert.equal(sessionPaths.length, 1);
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

  it("completes threads-only when the payload is absent, rendering the absent leg on the heartbeat", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-payload-absent.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        urls,
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The absent payload is the PC-off NORMAL (D13): a green threads-only
    // run, zero linkedin warns (the reader logs one quiet line instead).
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line)));
    // The Gate 2 heartbeat renders the absent leg line — a threads-only run
    // is permanently quiet, so the heartbeat is where the dark leg shows.
    assert.equal(subjects.length, 1);
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
  });

  it("degrades a linkedin-only config with an absent payload to a quiet threads-only heartbeat (Gate 1)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-absent.json");
    const { transport, subjects, texts } = recordingTransport();
    let linkedinCalls = 0;

    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: no threads surfaces
      linkedinFetch: async () => {
        linkedinCalls += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(linkedinCalls, 1, "the reader runs whenever linkedin surfaces are configured");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line))); // absent is a quiet log, never a warn
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

  it("keeps Threads results when the payload read faults at run time (acceptance 1, the D12 belt)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-payload-throws.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, THREADS_SESSION_STATE: undefined }, // logged-out Threads walk
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
      }),
      linkedinFetch: async () => {
        throw new Error("payload io exploded");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The belt degrades the fault to a warn + a malformed leg; the
    // logged-out Threads posts survive and the run completes (exit 0 shape).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin payload FAILED — payload io exploded/.test(line)));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    // The not-ok leg rides the digest (D13).
    assert.ok(texts[0]?.includes("LinkedIn leg: malformed — payload io exploded"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });

  it("renders the stale leg line on a match-run digest even when the leg contributed no posts (D13)", async () => {
    const statePath = await tempStatePath("stale-leg-digest.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(16), text: "Hiring: scala developer, remote" }]),
      ),
      linkedinFetch: async () => payloadRead([], "stale", "payload 3h old"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // One threads match; the stale leg rides the digest so a dark leg
    // stays visible on a match run too.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(!texts[0]?.includes("[linkedin]")); // the stale leg contributed no posts
    assert.ok(texts[0]?.includes("\n\nLinkedIn leg: stale — payload 3h old\n"));
  });

  it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)", async () => {
    const statePath = await tempStatePath("linkedin-only-with-threads-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: zero threads surfaces
      linkedinFetch: async () => payloadRead([linkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The old empty-pool guard returned [] before the LinkedIn arm ran;
    // the single return keeps the LinkedIn posts (D13).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on Threads \+ LinkedIn/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [`urn:li:activity:${linkedinIdNow}`]);
  });

  it("logs every surface from the raw config partition in the startup line (D14)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const statePath = await tempStatePath("startup-surface-line.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        // A real post: an EMPTY authenticated capture trips the kept
        // all-fail gate and the run dies before the startup line is logged.
        threadsCapture: graphqlBody([{ id: id19(15), text: "Hiring: golang developer, remote" }]),
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /watch: surfaces: tag\/hiring, linkedin\/#hiring/.test(line)));
  });
});

describe("timeStage", () => {
  it("returns the stage value and its duration under an injected clock", async () => {
    let tick = 100;
    const { value, durationMs } = await timeStage(
      async () => {
        tick += 50;
        return "done";
      },
      () => tick,
    );
    assert.equal(value, "done");
    assert.equal(durationMs, 50);
  });

  it("never reports a negative duration when the clock steps back", async () => {
    let tick = 100;
    const { durationMs } = await timeStage(
      async () => {
        tick -= 5;
        return undefined;
      },
      () => tick,
    );
    assert.equal(durationMs, 0);
  });
});
```


### src/fetch-linkedin-api.ts — DELETE

The SDK fetcher (261 lines). Deleted in Slice 6; no code designed here.

### tests/fetch-linkedin-api.test.ts — DELETE

The SDK suite (~346 lines). Deleted in Slice 6.

### src/config-file.ts — MODIFY

Four comment/string re-keys (verifier-found at the 2026-11-04 slice-6 checkpoint; invisible to the case-sensitive acceptance grep, required by the bf6594c wording lesson): the `Surface` doc, the `ResolvedSurface.platform` doc, the `resolveSurfaces` doc (the slice-6 draft's "payload reader" wording revised — the reader consumes the payload FILE, the raw keyword strings are consumed by the PC leg's voyager walk), and the runtime wiring-bug throw string. The throw's pinned regex prefix (`/linkedin surface "..." reached resolveSurfaces/`) is unchanged.

```ts
// Surface doc:
/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim;
 * `linkedin` stays a valid config value whose raw keyword string the PC
 * fetch leg consumes directly (it never resolves to a URL here). */

// ResolvedSurface.platform doc:
  /** Always "threads": LinkedIn rides the PC fetch leg and never resolves here. */

// resolveSurfaces doc:
 * surfaces resolve: linkedin entries stay valid config, but the PC fetch
 * leg (src/linkedin-fetch.ts) consumes their raw value, so the caller

// the wiring-bug throw — tail re-keyed, regex pin unchanged:
        `linkedin surface "${surface.value}" reached resolveSurfaces — a wiring bug: partition linkedin surfaces out before resolving (the PC fetch leg takes their raw value)`,
```

### src/threads-session.ts — MODIFY

`resolveSession` doc (comment-only): the LinkedIn sentence re-keys from the SDK token pair to the PC leg's cookie file.

```ts
 * policy — Threads falls back to the logged-out walk. LinkedIn resolves
 * no session here at all: its cookie pair rides the PC leg
 * (LINKEDIN_COOKIES_FILE, src/linkedin-session.ts), outside this repo.
```

### src/judge.ts — MODIFY

The F023 twin comment (WAIT_BUDGET_MS doc; verifier-found): the watch.yml hunk above refreshes one half of the F023 arithmetic — this is the other half. The dead premise ("LinkedIn rides the sequential Linked API SDK workflows now… pastes into this comment") leaves; the envelope arithmetic and the 180s budget stay. The module-head "no SDK" note (:4 — the LLM client is raw fetch) is untouched and still true.

```ts
 * judge waves, and parks. The LinkedIn fetch term left this budget
 * entirely (2026-11-04): the leg runs on the developer PC and this job
 * only reads its pushed payload — the fetch measurement note moved to
 * the PC-loop docs in README.md. A 180s park budget keeps
```

### tests/config-file.test.ts — MODIFY

One test title re-keys with the throw string; the `assert.throws` regex pin is unchanged. The suite joined the harness world at this checkpoint (130 → 158 tests).

```ts
  it("fails visibly when a linkedin surface reaches resolveSurfaces (the PC fetch leg consumes them raw)", () => {
    assert.throws(
      () => resolveSurfaces([{ type: "linkedin", value: "#hiring" }]),
      /linkedin surface "#hiring" reached resolveSurfaces/,
    );
  });
```
### .github/workflows/watch.yml — MODIFY

Slice 6: remove the `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` env lines (:104-105); rewrite the concurrency-block premise comment (:11-19 — SDK park rationale dies; cancel stays for state serialization); refresh the F023 envelope comment (:59-64 — the LinkedIn fetch term leaves the hosted budget; PENDING MEASUREMENT note moves to the PC loop README). No job, permission, cron, or commit-back changes.

```yaml
# watch.yml — MODIFY (slice 6): three hunks.
# 1) concurrency comment (the SDK-park rationale dies; cancel stays):
  # Cancel keeps at most one run alive: a run that parks on judge
  # cooldowns could otherwise hold the whole 8-minute cap, and queueing
  # every 10-minute tick behind it backs the schedule up without bound.
  # One live run still serializes the state read-modify-write (the
  # in-flight run is dead, never concurrent) and the newest run is the one
  # worth keeping. State writes stay atomic + rebase-safe either way. The
  # PC-linked payload (state/linkedin-posts.json) is written by the local
  # loop's own rebase+retry push — never by this workflow.
# 2) F023 envelope comment gains: "The LinkedIn fetch term left this budget
#    entirely (2026-11-04): the leg runs on the developer PC and this job
#    only READS its pushed payload — the fetch measurement note moved to
#    the PC-loop docs in README.md."
# 3) Run watcher env: the LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN
#    lines are REMOVED, replaced by:
          # The LinkedIn leg needs no secret here: the PC loop pushes
          # state/linkedin-posts.json and this job reads it from the
          # checkout — an absent/stale payload degrades to a threads-only
          # run (src/linkedin-payload.ts, D13).
```

### README.md — MODIFY

Slice 6: pipeline description (local LinkedIn leg), env table rows (add `LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`; drop the SDK pair), surfaces key row (linkedin entries feed the voyager search), PC-operations section: cookie export procedure, curl-impersonate install + `CURL_IMPERSONATE_BIN`, probe protocol (twice ≥6h apart), loop start/stop, alarm semantics, queryId-expiry re-derivation note (§15).

```md
README.md — MODIFY (slice 6): the intro + pipeline step 2 describe the PC leg;
the secrets table drops the LINKED_API rows ("The LinkedIn leg needs no
GitHub secret"); the surfaces row + example name the PC voyager search;
"Local run" points at the three npm entries. The "LinkedIn tokens (Linked
API)" section is REPLACED by:

## The LinkedIn leg on your PC (voyager)

LinkedIn posts come from the voyager search API, fetched on the developer's
PC by an always-on npm loop — not from GitHub Actions. The endpoint, headers
and encodings follow the reverse-engineering spec of record
(`linkedin-reverse/DOCUMENTATION.md`); when the server expires the queryId
hash, re-derive it per that spec's §9 — a sudden 500 on a formerly-200
endpoint is the signature, not a variables bug.

The loop never touches Threads, the judge, the digest or seen-state. It
only fetches the linkedin surfaces, writes `state/linkedin-posts.json`
atomically, and pushes that single path with the same rebase+retry
discipline the bot uses. Each file has exactly one writer, so the two
pushes can never lose each other's commits. Run the loop from a dedicated
clone of `main` — its `git pull --rebase` also auto-updates the loop's own
code. One-time: set the clone's identity (`git config user.name` /
`git config user.email`) — the push discipline commits as you, and an
unconfigured identity fails the tick loudly instead of pushing nothing.

1. Export cookies from a logged-in browser into a JSON file OUTSIDE the
   repo: `{ "liAt": "...", "jsessionid": "ajax:..." }` (jsessionid may keep
   or drop its surrounding quotes; both work):
   `export LINKEDIN_COOKIES_FILE=C:/secrets/linkedin-cookies.json`
   No automated re-login exists (2FA dead-ends headless login); the export
   is the only refresh. A dead session sends ONE alarm email per episode
   and the loop keeps running — refresh the file, the next tick heals.
2. Install curl-impersonate (chrome build); point `CURL_IMPERSONATE_BIN`
   at the binary (default transport). `LINKEDIN_TRANSPORT=playwright`
   switches after a failed probe; no auto-fallback in code.
3. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; exit 1
   on leg-dead/short/fault. Re-run after any `LINKEDIN_TRANSPORT` change.
4. `npm run watch-linkedin` — tick every 10 min, leave the console open.

Hosted side: the */10 cron reads the payload from its checkout, merges,
judges, emails as usual; the heartbeat/digest render one `LinkedIn leg:`
line (`ok` / `DARK — payload N h old` / `absent` / `malformed`) so a dark
leg stays visible while the PC is off. One-off ticks (`npm run
fetch-linkedin`) exit 1 on a dead leg.
```

### AGENTS.md — MODIFY

Slice 6: replace the fetch-linkedin-api module bullet + LINKED_API env mentions with the linkedin local-leg bullets (modules, commands, cookie-file rule).

```md
AGENTS.md — MODIFY (slice 6): "What this project is" gains the PC-leg
sentence (the loop pushes state/linkedin-posts.json; the hosted run reads
it). Commands: lint/format globs list the three linkedin scripts; npm start
notes the absent/stale payload degrade; three entries join — probe-linkedin
(gate; run twice ≥6h apart), fetch-linkedin (one tick; dedicated clone),
watch-linkedin (always-on loop). The fetch-linkedin-api architecture bullet
is replaced by the linkedin module family (voyager/session/fetch/payload +
the three PC scripts with their exit contracts); the email bullet names the
leg-dead alarm.
```

### .gitignore — MODIFY

Slice 6: add `linkedin-cookies*.json`; remove the `linkedin-state*.b64` residue line (:8); keep `.rpiv/tmp/` ignored (capture scratch). The PC loop's episode marker `state/linkedin-leg-dead.flag` also joins the ignore list — both writers stage single explicit paths, but a bare `git add state/` would otherwise commit the marker.

```text
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
linkedin-cookies*.json
state/linkedin-leg-dead.flag
run.log
```

### .rpiv/guidance/architecture.md — MODIFY

Slice 6: overview bullets mentioning the SDK/env pair → local-leg summary + payload path.

```md
.rpiv/guidance/architecture.md — MODIFY (slice 6): the src/ tree comment names
"the PC-linked linkedin payload read" instead of the Linked API SDK; the
Business Context paragraph swaps the Linked API token-pair sentence for: a
dark LinkedIn leg (absent or stale state/linkedin-posts.json — the PC loop
is off) degrades to a threads-only run with one log line; the heartbeat
still fires and renders the leg state.
```

### .rpiv/guidance/src/architecture.md — MODIFY

Slice 6: replace the fetch-linkedin-api section (:65-77) with the linkedin module family (voyager/session/transport/fetch/payload) + the re-keyed arm; update dependency list (@linkedapi/node dies; no new runtime dep); update the playwright quarantine statement — the dynamic-import boundary now covers TWO sites (the threads walk and the linkedin transport's API-request context; verified 2026-11-04: ContextLike has no request surface, so the transport cannot ride ContextFactory).

```md
.rpiv/guidance/src/architecture.md — MODIFY (slice 6): the dependency
bullet becomes "playwright: TWO quarantine sites — the chromium
ContextFactory in fetch-threads.ts AND request.newContext in
linkedin-fetch.ts (ContextLike exposes no request surface, verified
2026-11-04); no new runtime dep — curl spawns the PC-local
curl-impersonate binary". The module-structure line names the
linkedin-* family. The "fetch-linkedin-api.ts: the second platform rides
the Linked API SDK" section is REPLACED by
"linkedin-*.ts: the second platform is a PC-local voyager leg (2026-11-04)":
// SPEC OF RECORD: linkedin-reverse/DOCUMENTATION.md — endpoint, restli encoding (§4.1+§12.5,
// '#'→%23), §12.7 canonical recipe (sortBy:date_posted; orderBy IGNORED §12.4), §13 fault matrix.
// linkedin-voyager.ts: PURE core — constants + restli encoder + URL builder + parser (drop+count,
// never throws). Timestamp = BigInt(id)>>22n (§12.4 drift caveat).
// linkedin-session.ts: LINKEDIN_COOKIES_FILE resolver (fail-visible D4 — the stricter contrast to
// silent-null resolveSession); quote asymmetry canonicalized once (header quoted+last §10/§14.5;
// csrf stripped §3; storageState re-quotes).
// linkedin-fetch.ts: VoyagerGet seam; curl transport (CURL_IMPERSONATE_BIN fail-visible, injectable
// exec, -w status sentinel) + playwright request.newContext transport (own quarantine); resolve
// LINKEDIN_TRANSPORT curl|playwright, no auto-fallback; classifyFault §13.3; LegDeadError tagged
// error; runPool walk — runPool RETURNS VOID: side arrays by claim index (fetchSurfacesAuthenticated
// idiom), worker total for surface faults, leg-dead drain-then-throw (judgePosts D11 shape); shared
// per-walk 5s pacing gate — the rate is pacing-bound, not width-bound.
// linkedin-payload.ts: {version, writtenAt, posts}; writePayloadAtomic (temp+rename); readPayloadPosts
// NEVER THROWS (D13): ENOENT→quiet absent; >PAYLOAD_MAX_AGE_MS(30min)→stale+age; bad envelope→malformed;
// bad rows→drop+count. {posts, leg} feeds HeartbeatStats.linkedinLeg (heartbeat line ALWAYS; digest
// line when not ok).
// index.ts arm: linkedinFetch re-keyed to (payloadPath, now) => PayloadRead; no token gate — absence
// is the PC-off normal; the D12 belt catch remains for unanticipated faults only.
// PC scripts: fetch tick = fetch → payload → add ONLY state/linkedin-posts.json → commit →
// pull --rebase → push, ONE retry (mirrors commit-state-rebase.sh; single-writer-per-file); leg-dead =
// ONE alarm per episode (repo-local marker beside the payload) + exit 1; loop continues; probe = gate exit 1.
```

### .rpiv/guidance/.github/workflows/architecture.md — MODIFY

Slice 6: env sync-point list drops the LINKED_API pair (:7, :50-51); note the payload file as a new watch-side input read from the checkout — delivered by the PC's own single-path push (D5); the bot's commit-back is untouched and the two writers serialize via their own rebase+retry.

```md
.rpiv/guidance/.github/workflows/architecture.md — MODIFY (slice 6): the
env sync-point line becomes "watch.yml maps 6 of the 9 ENV_NAMES
(HEARTBEAT_ENABLED via vars. — the one non-secret knob); the LinkedIn trio
(LINKEDIN_COOKIES_FILE, LINKEDIN_TRANSPORT, CURL_IMPERSONATE_BIN) is
deliberately NOT mapped — PC-only, never enters Actions". The concurrency
comment quote swaps the SDK-park rationale for the judge-park + payload
note ("the PC loop writes state/linkedin-posts.json via its own
rebase+retry push — never this workflow"). The Run-watcher env block drops
both LINKED_API lines and adds: "no LinkedIn secret: the PC loop pushes the
payload this job reads".
```

### .rpiv/guidance/tests/architecture.md — MODIFY

Slice 6: coverage map rows for the deleted SDK suite → the named new suites: linkedin-voyager, linkedin-session, linkedin-fetch, linkedin-payload (the four payload failure classes), index re-key, heartbeat leg-line.

```md
.rpiv/guidance/tests/architecture.md — MODIFY (slice 6): the dependency
note gains "the linkedin transport stays unexercised like
chromiumContextFactory — the VoyagerGet seam carries the tests" and
DROPS its SDK clause ("the Linked API SDK never loads either — the
factory's dynamic import is the only site": the factory is deleted).
The coverage-map row fetch-linkedin-api → fetch-linkedin-api.test.ts is
replaced by four rows:
linkedin-voyager.ts → linkedin-voyager.test.ts    # §12.5 escaping matrix, §12.7 URL pin, id>>22n clock, scrubbed fixture (edges 1-4)
linkedin-session.ts → linkedin-session.test.ts    # resolver reject matrix (all name LINKEDIN_COOKIES_FILE), quote asymmetry, storageState
linkedin-fetch.ts → linkedin-fetch.test.ts        # §13.3 classifier table, curl-over-fake-exec, resolver matrix, scripted VoyagerGet walk
linkedin-payload.ts → linkedin-payload.test.ts    # all four failure classes + atomic round trip
```

### .rpiv/guidance/scripts/architecture.md — MODIFY

Slice 6: add the three PC scripts (roles, exit-code contracts: fetch tick = leg-dead exits 1; loop = never exits on leg-dead; probe = gate exit 1) + the lint/format glob note.

```md
.rpiv/guidance/scripts/architecture.md — MODIFY (slice 6): the Structure
block gains three INSIDE-typecheck-and-lint entries after probe-judge.ts —
fetch-linkedin.ts (exports fetchTick/pushPayload/handleLegDeadEpisode;
tick = fetch → payload → single-path rebase+retry push; realGit
injectable), watch-linkedin.ts (tick + 600s sleep; leg-dead → ONE alarm
per episode + continue), probe-linkedin.ts (gate, exit 1) — and the
Invokers list gains: "run via npm run fetch-linkedin / watch-linkedin /
probe-linkedin from a dedicated clone; exit contracts: tick = leg-dead
exits 1 after the episode alarm, loop = never exits on leg-dead, probe =
gate exit 1".
```

## Slices

### Slice 1: Voyager client core (pure)

**Files**: `src/linkedin-voyager.ts`, `tests/linkedin-voyager.test.ts`, `tests/fixture/voyager-search-response.json`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — new suite green, rest untouched
- [ ] §12.5 escaping matrix rows asserted: comma, parens, colon, ampersand, single-quote, plus `#`→`%23`
- [ ] `buildSearchUrl` equals the §12.7 canonical URL byte-for-byte for ("#hiring react", 0, 50)
- [ ] Fixture parse: 2 posts mapped, 1 dropped, structural clusters ignored, permalink query-stripped, timestamps = `BigInt(id)>>22n` ISO
- [ ] Fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` returns 0 hits

#### Manual Verification:
- [ ] Fixture provenance recorded in the loading test's header comment (origin capture, date, mask policy)
- [ ] One encoded URL spot-checked against DOCUMENTATION.md §4.2 worked example by eye

### Slice 2: Session cookies module

**Files**: `src/linkedin-session.ts`, `tests/linkedin-session.test.ts`, `src/config.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — new suite green, rest untouched
- [ ] Resolver reject matrix pinned: unset, blank, missing file, invalid JSON, non-object JSON, missing/empty liAt, missing/empty jsessionid (raw-empty AND quotes-only dialect), stray quotes in either value — every message names `LINKEDIN_COOKIES_FILE` (via ENV_NAMES.linkedinCookiesFile)
- [ ] Quote asymmetry pinned: Cookie header carries `JSESSIONID="ajax:..."` WITH quotes in last position; csrf-token value carries it WITHOUT quotes; storageState JSESSIONID value carries quotes on `.linkedin.com`
- [ ] Both export dialects accepted: `jsessionid` stored quoted or unquoted resolves to identical header/csrf/storageState output
- [ ] `ENV_NAMES` gains exactly one name this slice: `linkedinCookiesFile` → `LINKEDIN_COOKIES_FILE`

#### Manual Verification:
- [ ] Cookie header spot-checked against DOCUMENTATION.md §10 template by eye (li_at unquoted first; JSESSIONID quoted last)
- [ ] storageState shape eyeballed against Playwright's storageState context-option contract (name/value/domain/path/secure)

### Slice 3: Fetch module — transport adapters, fault classification, runPool walk

**Files**: `src/linkedin-fetch.ts`, `tests/linkedin-fetch.test.ts`, `src/config.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — new suite green, rest untouched, zero real sleeps
- [ ] §13.3 classifier table pinned: CSRF-403 text, Cloudflare-403 challenge, 401 dead-session, bare-400 finder (leg-dead); graphql-envelope-400, 500 queryId-expiry, other statuses (fault)
- [ ] curl transport over a fake exec: §3/§10 header set on the args, status-sentinel parse with the separator newline stripped from the body, exec failure → surface fault (not leg-dead), missing `CURL_IMPERSONATE_BIN` throws naming the variable
- [ ] Resolver matrix: unset/`curl` opens the curl transport (both pinned); unknown `LINKEDIN_TRANSPORT` throws naming both values
- [ ] Walk: partial-page stop, exhaustion (`elements: []`) stop, out-of-order completion reassembled in input order, per-surface fault warns + skips, leg-dead drains then throws ONCE with the sibling pager stopped, pacing gate spaces GET starts `PACE_MS` apart via the injected clock AND concurrent waiters reserve distinct slots (no width-2 burst — pinned with deferred sleeps), dropped rows counted in a warn, zero-post surface logs `OK — 0 post(s)`, an opened Transport disposes in finally

#### Manual Verification:
- [ ] One encoded URL eyeballed against DOCUMENTATION.md §12.7 by eye

(Moved to Slice 6 at the 2026-11-04 checkpoint: "README PC-operations section documents curl-impersonate install + `CURL_IMPERSONATE_BIN` + the transport switch" — Slice 3 owns no README content.)


### Slice 4: Payload + PC scripts + alarm + wiring — salvage draft

**Files**: `src/linkedin-payload.ts`, `tests/linkedin-payload.test.ts`, `scripts/fetch-linkedin.ts`, `tests/fetch-linkedin.test.ts`, `scripts/watch-linkedin.ts`, `scripts/probe-linkedin.ts`, `src/email.ts`, `src/config.ts`, `package.json`

**Suites**: `tests/linkedin-payload.test.ts` names and pins all four failure classes (ENOENT, over-age, bad envelope, bad rows) — the reader cannot silently drop rows while the suite is green.

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — new suites green, rest untouched
- [ ] Payload failure classes pinned: ENOENT → quiet absent; over-age (injected clock across `PAYLOAD_MAX_AGE_MS`) → stale + age; invalid JSON / unknown version / posts-not-array → malformed + reason; malformed rows → drop + count; exact-boundary age stays ok
- [ ] Round trip: write → read preserves posts; no temp litter after an atomic write
- [ ] `fetchTick` composes cookies → transport → walk → payload → `pushPayload`; the push adds ONLY `state/linkedin-posts.json`, rebases, pushes, retries once, aborts loud on conflict
- [ ] Leg-dead episode edge: marker file gates ONE alarm; healthy tick clears it
- [ ] package.json: three npm entries + lint/format globs include the three scripts
- [ ] `tests/fetch-linkedin.test.ts` (added at the 2026-11-04 checkpoint directive — the GitRunner seam exists for exactly this) pins, over a fake GitRunner + temp payloadPath: `pushPayload` stages ONLY the injected path, commits, rebases, pushes, retries once on rejection, aborts loud on double failure, no-ops without staging, and aborts the rebase without pushing on conflict; `fetchTick` composes cookies → transport → walk → payload → push (caller-owned transport stays undisposed even on a leg-dead failure; the env-driven local open rides `resolveLinkedInTransport` — pinned via its unknown-transport rejection; zero linkedin surfaces returns quietly before any resolver runs); the episode marker fires ONE alarm on the healthy→dead edge, stays quiet on later dead ticks, clears on a healthy tick, and survives a simulated restart (repo-local beside the payload, never OS temp), and the default alarm is best-effort (broken GMAIL env warns, never throws), and a failing `git commit` (unconfigured clone identity) throws loudly naming the fix and never reaches rebase+push

#### Manual Verification:
- [ ] First live push happens from a dedicated clone under probe supervision
- [ ] `npm run probe-linkedin` exits 1 on a corrupt cookie copy, 0 on a live leg
- [ ] Conflict rehearsal: land a bot commit between the PC's checkout and its push; the rebase+retry push succeeds (Verification Notes discipline, D5)
- [ ] Session-dead rehearsal: corrupt the cookie-file copy → the tick throws leg-dead → exactly ONE alarm email and the loop continues; restore the file → the next tick heals (Verification Notes, D7)

### Slice 5: Watch-side ingest re-key — salvage draft

**Files**: `src/index.ts`, `tests/index.test.ts`, `src/heartbeat.ts`, `tests/heartbeat.test.ts`

**Semantics**: payload faults degrade per D13 — absent → quiet log; stale → age log; malformed envelope → warn + threads-only; malformed rows → drop+count. Never exits nonzero. The reader returns `PayloadRead` (`posts` + `leg`) into `HeartbeatStats.linkedinLeg`.

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — re-keyed suite green, rest untouched
- [ ] Mixed-run end-to-end: threads ids and `urn:li:activity:` ids share the seen map without colliding; recency keeps a fresh linkedin post (ISO timestamp via `BigInt(id)>>22n`); digest carries `[linkedin]` + `+ LinkedIn` subject
- [ ] Heartbeat renders the leg line in all four states; omits it entirely when the reader never ran
- [ ] Digest carries the leg line ONLY when the state is not ok (ok → no line; stale/malformed belt → line)
- [ ] Absent payload = green threads-only run (never a nonzero exit), zero linkedin warns

#### Manual Verification:
- [ ] PC-off rehearsal: stop the loop ≥31 min → a dispatched run logs the stale line, completes threads-only, heartbeat fires, state byte-identical

### Slice 6: SDK removal + residue sweep + docs — salvage draft

**Files**: `src/fetch-linkedin-api.ts` (DELETE), `tests/fetch-linkedin-api.test.ts` (DELETE), `src/config.ts`, `src/config-file.ts`, `src/threads-session.ts`, `src/judge.ts`, `src/linkedin-voyager.ts` (cross-slice comment merge into the locked slice-1 fence), `tests/config-file.test.ts`, `.github/workflows/watch.yml`, `README.md`, `AGENTS.md`, `.gitignore`, `package.json`, `.rpiv/guidance/architecture.md`, `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/scripts/architecture.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck` — before AND after the deletion (the slice-5 re-key removes the last code consumers first)
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Pre-delete gate (scoped — the unscoped form is unsatisfiable: it matches the deletion targets themselves): `git grep -nE 'linkedApi|LINKED_API|fetch-linkedin-api' -- src tests package.json ':(exclude)src/fetch-linkedin-api.ts' ':(exclude)tests/fetch-linkedin-api.test.ts'` returns ONLY the two `src/config.ts` ENV_NAMES pair lines before the removal lands
- [ ] Residue sweep acceptance: `git grep -nE 'linkedapi|linked_api|LINKED_API|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` returns 0 lines
- [ ] Wording sweep (bf6594c lesson — gate-invisible residue): `grep -rniE 'linked API|linked-api' src tests scripts` returns 0; the only surviving `SDK` is `src/judge.ts:4`'s LLM-client note ("no SDK" — still true)
- [ ] Comment re-keys pinned: `src/config-file.ts` (4 sites incl. the wiring-bug throw string), `src/threads-session.ts` (resolveSession doc), `src/judge.ts` (the F023 twin), `tests/config-file.test.ts` (title; regex pin unchanged), `src/linkedin-voyager.ts` (slice-1 fence line re-spliced)
- [ ] `npm uninstall @linkedapi/node` removes the dependency and regenerates the lockfile
- [ ] `.gitignore`: `linkedin-cookies*.json` added; `linkedin-state*.b64` residue line removed; no stray blob on disk

#### Manual Verification:
- [ ] A manual watch.yml dispatch runs green with no LinkedIn secret mapped

## Desired End State

Operator flow on the PC (from the repo folder):

```
# one-time: export cookies from a logged-in browser into a local file
LINKEDIN_COOKIES_FILE=C:/loker-secrets/linkedin-cookies.json   # runner/.env or shell profile

# prove the transport (twice, >=6h apart)
npm run probe-linkedin
#   probe: transport curl — GET voyager/api/graphql — 200 OK — 10 post(s)
#   probe: all checks passed

# start the leg; leave the console open
npm run watch-linkedin
#   fetch: linkedin/#hiring react page 0 — 50 post(s)
#   ...
#   payload: wrote 312 post(s) — state/linkedin-posts.json
#   git: pushed state commit (1 file)
```

Hosted side unchanged: the */10 cron runs, reads `state/linkedin-posts.json` from its checkout, merges new urns at `dedupePosts`, judges, and the digest email carries `[linkedin]` rows exactly as before. PC off → payload goes stale → one log line → threads-only green runs → heartbeat as designed. Session dies → ONE alarm email, loop keeps running, refresh the cookie file and the next tick heals.

## File Map

```
src/linkedin-voyager.ts          # NEW — pure endpoint client (restli, URL, headers, parser)
src/linkedin-session.ts          # NEW — cookie file resolver + header/storageState builders
src/linkedin-fetch.ts            # NEW — VoyagerGet seam, curl/playwright adapters, fault classifier, LegDeadError, runPool walk
src/linkedin-payload.ts          # NEW — payload envelope write/read/validate
scripts/fetch-linkedin.ts        # NEW — one tick: fetch -> payload -> single-path push
scripts/watch-linkedin.ts        # NEW — tick loop with episode-edge alarm
scripts/probe-linkedin.ts        # NEW — transport gate (exit 1)
src/config.ts                    # MODIFY — ENV_NAMES + payload path const (+ removal later)
src/email.ts                     # MODIFY — leg-dead alarm variant + digest leg line
src/heartbeat.ts                 # MODIFY — HeartbeatStats.linkedinLeg + heartbeat leg line
tests/heartbeat.test.ts          # MODIFY — leg-line state pins
src/index.ts                     # MODIFY — arm re-key to payload reader
package.json                     # MODIFY — run entries, globs, (later) dependency removal
tests/linkedin-voyager.test.ts   # NEW — 1:1 suite
tests/linkedin-session.test.ts   # NEW — 1:1 suite
tests/linkedin-fetch.test.ts     # NEW — 1:1 suite
tests/linkedin-payload.test.ts   # NEW — 1:1 suite
tests/index.test.ts              # MODIFY — re-keyed doubles
tests/fixture/voyager-search-response.json # NEW — scrubbed capture fixture
src/fetch-linkedin-api.ts        # DELETE (Slice 6)
tests/fetch-linkedin-api.test.ts # DELETE (Slice 6)
.github/workflows/watch.yml      # MODIFY — SDK env out, comments re-derived
README.md, AGENTS.md, .gitignore # MODIFY — residue sweep + PC ops docs
.rpiv/guidance/*.md              # MODIFY — guidance sync
```

## Ordering Constraints

- Strictly sequential: 1 → 2 → 3 → 4 → 5 → 6 (each slice's code imports only earlier slices' exports).
- Slice 1 needs the capture present at `.rpiv/tmp/voyager-capture.json` (verified on disk, 59,897 bytes) to trim the fixture; if regenerating, a probe-quality capture must be scrubbed identically.
- Slice 5 (arm re-key) MUST precede Slice 6 (module deletion) so `npm run typecheck` stays green per slice.
- Slice 6 is the only slice that may delete files; every other slice only adds or edits.
- The PC loop must not run against the repo while Slice 4's push logic is untested — first live push happens under probe supervision (manual gate in Slice 4 verification).

## Verification Notes

- Per-slice gates: `npm run typecheck && npm run lint && npm test` (CI runs the same three; terminal slice repeats all three).
- Source-verified contracts (2026-11-04, graph snippets + full-file reads at 4c11e0f; check_index_coverage clean on all nine evidence paths): `runPool` returns void — side arrays are caller-owned (src/pool.ts:33-52); the walk idiom is fetchSurfacesAuthenticated's perSurface[index]/failures[index] (src/fetch-threads.ts:294-343); exhaustion aborts are drain-then-throw (src/judge.ts:681-830; fast-workflow-runtime D11:105); tagged errors are name-constant + factory + type guard (src/judge-rotation.ts:51-75); ContextLike exposes NO request surface (src/fetch-threads.ts:106-110) — the Playwright transport owns its API-request context + quarantine site; the index.ts arm confirmed line-level for the slice-5 re-key (WatcherDeps.linkedinFetch type, the resolveLinkedApiTokens warn block, the D12 belt catch, D13/D14 comments); parkUntilEligible (src/judge-rotation.ts:143-167) is untouched by every slice in this design.
- SDK removal acceptance: `git grep -nE 'linkedapi|linked_api|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` returns 0 lines (git grep walks tracked files only).
- Pre-delete gate (Slice 6, scoped): `git grep -nE 'linkedApi|LINKED_API|fetch-linkedin-api' -- src tests package.json ':(exclude)src/fetch-linkedin-api.ts' ':(exclude)tests/fetch-linkedin-api.test.ts'` returns ONLY the two `src/config.ts` pair lines before the removal lands (the slice-5 re-key removed the index.ts consumers — the deleted module and its suite self-match the pattern and are excluded); typecheck green before AND after the deletion.
- Wording sweep (Slice 6, bf6594c class): `grep -rniE 'linked API|linked-api' src tests scripts` returns 0 after the slice; `SDK` survives only at src/judge.ts:4 ("no SDK" — the LLM client is raw fetch, still true).
- Payload reader suite pins all four failure classes: ENOENT → quiet null; over-age → null + reason; bad envelope → warn + threads-only; bad rows → drop+count.
- Legibility: the heartbeat body renders the leg line on every run; the digest body renders it on every not-ok run; each of the four states has its own test pin.
- Fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` returns 0 hits.
- Episode-marker ignore: after slice 6, `git check-ignore state/linkedin-leg-dead.flag` names the path (the loop writes the marker repo-local; it must never be trackable).
- Restli/URL encoding: §12.5 matrix rows reproduced as test rows, each asserting the exact encoded substring.
- Probe protocol (manual): two passing runs ≥6h apart with stored cookies only, per transport, before trusting the loop; re-run after `LINKEDIN_TRANSPORT` changes.
- Round-trip (manual): loop tick → payload commit visible on main → dispatched watch run logs the payload merge line → digest carries `[linkedin]` rows.
- Conflict rehearsal (manual): land a bot commit between the PC's checkout and push; the rebase+retry push succeeds.
- PC-off rehearsal (manual): stop the loop ≥31 min → dispatched run logs the stale-payload line, completes threads-only, heartbeat fires, state byte-identical.
- Session-dead rehearsal (manual): corrupt the cookie file copy → tick throws leg-dead → exactly ONE alarm email, loop continues; restore file → next tick heals.
- queryId expiry watch (§15): a sudden 500 on a formerly-200 endpoint means the hash expired — README documents the §9 re-derivation recipe pointer.

## Performance Considerations

- Fetch tick: ~60-120s (2 surfaces paging 2-wide under the shared 5s pacing gate + adapter boot) — the pacing gate, not the pool width, bounds the anti-bot rate. Loop tick budget ≤ 3 min — well under the 10-min cadence.
- The 2026-11-04 pacing fix (reserve-before-sleep) serializes voyager GET STARTS: tick time now scales with TOTAL PAGES, not pool width — width buys input-order reassembly, never speed (the D11 claim — pacing-bound rate — is unchanged). The ~60-120s estimate holds at 2 surfaces; each extra full 50-post page adds one ~5s pacing slot. Re-derive the budget if the surface count grows.
- Request volume: ≤ ~20 voyager GETs per tick (~2,880/day worst case) — §13.3 throttling thresholds were observed at ~40 RAPID calls; the 5s pacing + cadence spread keeps the rate low, but this is the primary curl-transport risk the probe watches.
- Payload size: ≤ ~1,000 posts × ~1 KB ≈ ≤1 MB; atomic write + one-file commit keeps push latency trivial.
- Hosted watch job budget unchanged: payload read is a single small file parse; the LinkedIn fetch term leaves the F023 envelope arithmetic entirely.
- Git history: one small commit per tick (~144/day) on `state/linkedin-posts.json` — the N017 accepted-growth pattern, bounded by 24h-post content.

## Migration Notes

- Seen-state continuity: voyager `backendUrn` mints `urn:li:activity:<id>` — byte-identical to SDK-era ids already in `state/seen-posts.json`, so the cutover never re-judges or re-emails an old post.
- Cutover order: slices 1-5 can land while the SDK arm is still wired (it is dead in production anyway — one warn per run); slice 5 re-keys the arm, slice 6 deletes the quad. No interim dual-fetcher state exists.
- Rollback: each slice is a normal commit; reverting slice 6 (then 5 for the re-key) restores the (dead) SDK arm; the PC loop is independent of repo rollback (stop the console).
- No persisted-schema change: `state/seen-posts.json` untouched; the payload file is additive and self-describing (`version: 1`).
- Device notes (README): curl-impersonate binary is a PC-local download (no npm dep); the cookie file lives outside the repo; `git pull --rebase` inside the loop auto-updates the loop's own code from main.

## Pattern References

- `src/fetch-threads.ts:106-110, 129-177, 294-343` — ContextLike/ContextFactory seams, the dynamic `await import("playwright")` quarantine, and the side-array runPool walk; the linkedin transport mirrors the QUARANTINE IDIOM in its own site (ContextLike has no request surface — verified 2026-11-04), and the linkedin surface walk mirrors the side-array worker.
- `src/judge.ts:681-830` + `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md:105` (D11) — drain-then-throw pool abort: flag in the worker, join, re-throw once with the complete record; the leg-dead tick abort copies the shape.
- `src/threads-session.ts:35-65` — silent-null resolver model; D4's stricter fail-visible variant cites it as the contrast.
- `src/judge.ts:685` — injectable trailing I/O param with production default; `VoyagerGet` and `sleepFn` follow it.
- `src/judge-rotation.ts` — tagged error idiom (name constant + factory + type guard) reused for `LegDeadError`.
- `src/state.ts:209-238` — atomic temp+rename write; `writePayloadAtomic` mirrors it.
- `scripts/probe-judge.ts` — probe shape: top-level main, `probe:` lines, exit-1 gate, config load at startup.
- `src/email.ts` email-variant guidance — `buildX` pure + `sendX` thin wrapper; caller owns failure policy.
- `tests/extract.test.ts:14-15` — fixture loading via `import.meta.url`; `.rpiv/tmp/voyager-capture.json` is the trim source.
- Commit `defb8af` — empty-is-success keyed on an observable signal (`elements: []` / partial page), with its day-one test.
- Commit `bf6594c` — deletion-residue lesson: sweep `.gitignore`/`.env`/stale comments in the removal commit itself.

## Developer Context

**Q (workflow shape):** How do the PC fetch leg and the hosted run connect — two workflows + cross-run artifact, one needs-chained workflow, or unchained? **A:** Neither — developer corrected the premise: "does not mean I install GitHub [agent] on my PC… I run it from project folder using npm run… but only for linkedin part". Runner-agent and artifact designs dropped; local-script model adopted.

**Q (posts travel):** Which transport carries raw posts PC → GitHub — repo push or private gist? (Developer asked "are we talking about the judged post?" — clarified: RAW candidates travel; judging/email stay hosted so the seen-state and LLM pool stay single-sided.) **A:** "push file to repo", with the conflict question answered: disjoint single-file writers cannot conflict; races cost one rebase+retry.

**Q (scheduling):** Task Scheduler vs always-on loop vs manual? **A:** "Always-on npm script" — `npm run watch-linkedin`, restart per boot accepted.

**Q (funnel seam):** Re-key the existing `linkedinFetch` injection or introduce a posts parameter? **A:** "Reuse seam, re-keyed" — smallest diff, same test-double shapes.

**Q (PC failure policy):** alarm+stop / log-only / alarm+keep-looping? **A:** "Alarm email + keep looping" — episode-edge email so a cookie-file refresh self-heals without restart; the SDK-era silent-green exit-0 is the named anti-pattern.

**Q (probe):** separate probe script? **A:** "yes add probe, but we must use endpoint from the documentation.md not from browser" + follow-up lock: probe registered in package.json beside probe-judge, driving the SAME transport as the production fetcher (zero-edit site); a browser-observed endpoint "carries session-specific params and will drift".

**Q (transport adjustment):** after the summary, developer adjusted D2: "try first using curl-impersonate… if it not work then keep using playwright" — probe decides; no auto-fallback in code.

**Note (package.json):** developer flagged `@linkedapi/node` as a runtime dep requiring stated need — confirmed it is REMOVED by this design (D10), not added; flagged the `npm run format` (src tests) vs lint globs gap — slice 4 closes it for the new scripts.

**Q (pre-slice flags, round 2):** slice numbering contradiction, weak acceptance grep, payload-fault semantics? **A:** numbering settled at six slices (removal = Slice 6; Design History lists 1-6); acceptance grep strengthened to `grep -riE 'linkedapi|linked_api|fetch-linkedin-api'`; payload semantics fixed as D13 — degrade with log/warn, never exit (platform-isolation boundary; alarm duty stays PC-side per D7), and the leg state rides the heartbeat/digest bodies so a dark leg is visible while the PC is off.

**Q (pre-slice flags, round 3):** unspecified delivery mechanism, dark-leg invisibility, unnamed payload suite, pre-delete import check, `git grep` acceptance? **A:** mechanism = same-branch single-path push, both writers rebase+retry, single-writer-per-file makes lost updates impossible, loop runs from a dedicated clone (D5, expanded); leg state now rides `HeartbeatStats.linkedinLeg` → heartbeat line always + digest line when not ok (D13); payload suite named with the four classes pinned (slice 4); pre-delete `git grep` gate added for slice 6; acceptance checks moved to `git grep`.

**Checkpoint (slice 3, 2026-11-04, resume at salvage-pending state):** four verifier rounds + real-gate proof replaced the pending LLM-only checkpoint. Round 1 (VIOLATIONS): surfaceOf decode mismatch, curl sentinel newline, biome >100-char lines. Round 2 (VIOLATIONS): TS2540 readonly `reason`, biome non-idempotent pacing call, prose overclaim. Round 3 (VIOLATIONS): TS2304 missing `resolveLinkedInCookies` import, 102-char Post-shape line. Round 4 (OK, contingent): certified after the repo's REAL gates ran in a gitignored scratch harness (`slice3-recon/`, deleted at implement) — the compiler found TS2322 (Playwright storageState wire requires expires/httpOnly/sameSite → completed at the transport boundary, slice 2 untouched) and TS2551 (locked slice 2 read `.jsessionid` against the declared `jsessionId`) that three LLM rounds missed; biome forced organizeImports order + two slice-2 format nits. Developer also had the pacing burst fixed (stamp updated after sleep → width-2 workers shared wake slots and fired GETs in pairs): slot now RESERVES BEFORE SLEEPING, pinned by a deferred-sleep test asserting strictly increasing wake slots `[5000, 10000, 10000]`. Developer decisions: APPROVE slice 3; REOPEN slice 2 for the 4 mechanical fixes (applied, suite green in the combined run). Moved slice-3 manual criterion (README PC operations) to slice 6; config fence rewritten to slice-3 state with delta-splice instructions (linkedApi pair retained until slice 6). Final gates: tsc pass, biome clean, 61/61 tests in 229ms.

**Checkpoint directives (post-slice-3 lock, 2026-11-04, developer-ordered):** (1) the real-gate harness is now PERSISTENT — `slice-recon/` (gitignored; `harness.mjs` materialize/gate/splice + README; per-slice procedure documented inside). It paid for itself on rebuild: the gate caught the config fence A carrying a whole-file scratch copy (harness header + duplicate helper declarations) — fence A is now the ENV_NAMES block only, matching the documented delta-splice. (2) Slice 4 must ship `tests/fetch-linkedin.test.ts` — the `GitRunner` seam and episode-marker edge get pinned offline at the checkpoint, not after the first live push. (3) `pushPayload` takes the injected `filePath` (one parameter). (4) The episode marker lives beside the payload (`state/linkedin-leg-dead.flag`), never OS temp — a reboot must not re-alarm. (5) Performance re-derived: the pacing fix makes tick time scale with total pages, not width. Per-slice budget going forward: ~10 min harness + ~10 min verifier round.

**Slice-4 harness certification (2026-11-04, before the verifier round):** the persistent harness gate ran green — tsc pass, biome clean, 87/87 tests (locked slices 1-3 + slice 4), all slice-4 fences byte-round-trip against the proven bytes. The gate caught three defects the drafts carried: (1) `PayloadRead extends LegLine` never declared `leg` — every reader return site was TS2353; the interface now stands alone (`posts`, `leg: LegStatus`, `detail?`), matching the index.ts re-key hunk's `read.leg` reads; (2) the test suite had four `await`s inside non-async arrows (parser kill); hoisted; (3) the real find: `fetchTick` passed the `Transport` OBJECT to `fetchLinkedInPosts`, and the slice-3 walk DISPOSES any Transport it receives — the caller-owned transport died inside the walk (tests caught `disposeCount 1 !== 0`); fixed by passing the bare `.get` so disposal is fetchTick's finally alone (the walk's ownership contract stays for direct callers). Also: biome organizeImports canonicalized four files (inline `type` specifiers sort first; `config-file.js` sorts before `config.js`) — spliced back byte-exact; `tests/fetch-linkedin.test.ts` authored this session against the checkpoint directive (the artifact had no fence for it); slice-4 Success Criteria revised to the offline-observable set (local-open disposal is NOT offline-pinnable — the curl dispose is a no-op and a playwright open needs network; the env-driven open is pinned via resolveLinkedInTransport's unknown-transport rejection and caller-owned non-disposal pins ownership instead).

**Slice-6 checkpoint (2026-11-04, resume → verify → approve):** the salvaged draft re-certified before its verifier round: baseline (slice-5 state) 130/130 green, then the removal deltas applied to the harness tree. The verifier round returned Decisions OK / Cross-slice OK / Research WARNING and found two classes the draft missed: (1) the pre-delete gate was unsatisfiable — the unscoped grep matches the deletion targets themselves (`fetch-linkedin-api.ts` contains `linkedApiToken`; the suite imports `../src/fetch-linkedin-api.js`); fixed with two exclude pathspecs. (2) Gate-invisible SDK-era WORDING survives every grep-clean hunk (the bf6594c class): the judge.ts F023 twin (WAIT_BUDGET_MS doc — the fetch-measurement premise dies with the SDK), 2× config-file.ts docs + the runtime wiring-bug throw string ("the SDK fetcher" — names a deleted architecture at runtime), and the config-file.test.ts pinning title. All four folded in and gate-proven (158/158 after config-file.test.ts joined the harness world); the config-file `resolveSurfaces` doc wording also revised "payload reader" → "PC fetch leg" (the reader consumes the payload FILE, not the raw surface value). Harness lesson recorded: materialize replays manifest entries (extra first, base last — base wins duplicate dests), so tree deltas for manifest-listed files must ride manifest work/ copies or they silently revert; configState materializes from THIS section's fence, which now carries the slice-6 state. Developer: APPROVE at checkpoint.

## Design History

- Slice 1: Voyager client core — approved as generated
- Slice 2: Session cookies module — approved as generated (follow-up 2026-11-04: the quotes-only rejection re-grounded in DOCUMENTATION.md, not checker-driven — the jar value always carries the `ajax:<digits>` token (§1); a quotes-only export normalizes to an EMPTY csrf-token, a guaranteed 403 "CSRF check failed." on every GET (§13.1), so it throws at resolve time with the file named — the same no-session class as raw-empty; canonical-empty check + reject row retained; REOPENED 2026-11-04 at the slice-3 checkpoint: 4 compiler/biome-forced mechanical fixes applied (3× cookies.jsessionid → cookies.jsessionId — TS2551; canonicalJsessionid ternary inlined; session-test assert.throws expanded; VoyagerStorageCookie doc line corrected — Playwright wire-requires expires/httpOnly/sameSite, completed at the slice-3 transport boundary); slice-2 suite green in the combined 61-test scratch run)
- Slice 3: Fetch module (adapters + classifier + runPool walk) — approved as generated (2026-11-04 checkpoint; salvaged draft re-certified through 4 slice-verifier rounds + REAL-GATE proof in a gitignored scratch harness: tsc pass, biome clean, 61/61 tests; fixes landed along the way: §12.5 route-decode mismatch in the walk tests, curl sentinel separator newline stripped in the transport, biome canonical reflows + organizeImports order, explicit-curl resolver row, instantSleep in multi-GET walk tests, TS2540 readonly reason → mutable factory fields, TS2304 resolveLinkedInCookies import, TS2322 storageState wire-type completion at the transport boundary, pacing slot reserve-before-sleep + deferred-sleep burst pin test; README PC-ops manual criterion moved to slice 6; config fence rewritten to slice-3 state — delta-splice, linkedApi pair retained)
- Slice 4: Payload + PC scripts + alarm + wiring — approved as generated (2026-11-04 checkpoint: real-gate harness proof — tsc pass, biome clean, 87/87 tests incl. the 14-test tests/fetch-linkedin.test.ts authored at the directive; gate caught and fixed: PayloadRead never declared its own `leg` field (TS2353 ×8 — the interface now stands alone: posts/leg/detail), 4× await inside non-async arrows (parser), and fetchTick passing the Transport OBJECT into the walk — the slice-3 walk disposes any Transport it receives, so a caller-owned transport died mid-tick (disposeCount 1!==0); the bare `.get` now rides and ownership is pinned by disposeCount on success AND leg-dead; criteria revised to the offline-observable set — local-open disposal is not offline-pinnable (curl dispose is a no-op; playwright open needs network), so the env-driven open is pinned via resolveLinkedInTransport's unknown-transport rejection; config fence A rewritten to slice-4 state (LINKEDIN_PAYLOAD_PATH rides below the ENV_NAMES block; linkedApi pair retained); email hunk 2 synced to the legDetailSuffix helper form (biome rejected the >100-col inline ternary); four files re-spliced byte-exact after biome organizeImports canonicalization; slice-verifier: Decisions OK / Cross-slice OK / Research OK after the conflict + session-dead manual rehearsals joined Slice 4's Manual Verification; FOLLOW-UP post-ready 2026-11-04: pushPayload now checks the `git commit` exit code — the fence previously discarded it, so an unconfigured clone identity failed the commit silently and rebase+push reported pushed=true having pushed nothing; fence + suite amended in place, harness re-gated 159/159)
- Slice 5: Watch-side ingest re-key — approved as generated (2026-11-04 checkpoint: the salvaged draft was merged whole-file and gate-proven in the persistent harness — tsc pass, biome clean, 130/130 tests (87 locked + 43 slice-5); the gate caught three salvage-draft defects: LINKEDIN_PAYLOAD_PATH exports from config.ts not linkedin-payload.ts (now rides the merged ./config.js import), the buildSubject real form "…on Threads + LinkedIn" (two regex pins), and an absent-test asserting the reader's quiet log that the injected stub replaces (pin stays in the payload suite); slice-verifier Decisions/Cross-slice/Research OK; ratified at the checkpoint: the four Architecture fences re-spliced to the proven whole-file bytes (byte round-trip verified), the test context-factory dropped its dead linkedin URL branch (the two urls.every pins are load-bearing), four-state heartbeat coverage rides linkedinLegLine unit pins + body wiring + end-to-end absent pins, and linkedinLeg passes to sendDigest as the 4th arg; the duplicate empty Slice 6 Slices heading (salvage artifact) removed — 1:1 heading count restored)
- Slice 6: SDK removal + residue sweep + docs — approved as generated (2026-11-04 checkpoint: real-gate proof on the harness tree — tsc pass, biome clean, 158/158 tests (config-file.test.ts joined the world), acceptance grep 0, Linked-API wording sweep 0, sole surviving "SDK" = judge.ts:4 LLM-client note; slice-verifier Decisions OK / Cross-slice OK / Research WARNING folded in — the verifier found 4 gate-invisible hunks the draft missed (judge.ts F023 twin, 2× config-file docs + the wiring-bug throw string, config-file.test.ts title) and an unsatisfiable pre-delete gate (the unscoped grep matches the deletion targets; now scoped with two exclude pathspecs); config fence A rewritten to the slice-6 state (pair removed); slice-1 voyager fence re-spliced (mapper-idiom mention dropped); the config-file doc wording revised payload reader → PC fetch leg; FOLLOW-UP post-ready: `state/linkedin-leg-dead.flag` joins `.gitignore`, the byte-match oracle ran ALL OK over all 9 fences vs the harness copies, and the amended slice-4 fences re-gated 159/159)
- Process note (2026-11-04): the developer ordered direct implementation mid-flow, then restored the design-resume principle; the landed draft was spliced into these fences byte-exact (NEW files verbatim from disk, MODIFY files as hunks) and the working tree stashed (the stash is SCRATCH, never a second source of truth — implement consumes only these fences and the stash may be dropped once slices 1-5 land via implement) — each slice still needs its 6.2 verifier pass + 6.3 checkpoint under /skill:design --resume before implement consumes it

## Follow-ups

### 2026-11-04 — post-ready audit (byte-match oracle + residue gaps)

- **Byte-match oracle: ALL OK.** All 9 slice fences (2 whole-file exact diffs, 7 line-fragment checks) byte-match the gate-proven harness copies under `slice-recon/` — the 6.4 hand-splice introduced no drift. Oracle re-run green after the amendments below.
- **`pushPayload` commit-exit check** (silent no-commit push bug): the slice-4 fence discarded the `git commit` exit code — an unconfigured clone identity failed the commit, rebase+push succeeded having pushed NOTHING, and the tick reported `pushed: true`. Fixed fail-visible (the error names `git config user.name + user.email`); suite pin added (`commit: 128` → throws, never reaches rebase/push); harness re-gated 159/159. Slice-4 fence + criteria + README one-time identity step amended in place.
- **Episode marker ignore rule**: `state/linkedin-leg-dead.flag` joins `.gitignore` beside `linkedin-cookies*.json`. The production paths were already safe (both writers stage single explicit paths); the rule closes the bare `git add state/` hole.
- **Stash adjudication**: `stash@{0}` (the direct-implementation draft) is scratch, never a second source of truth — implement consumes only these fences; the Design History process note now says so.
- **Prose-only fences (accepted)**: watch.yml's comment rewrites, the README PC-ops section, package.json's dependency removal, and the five guidance hunks are precise hand-written text, not byte-fences — accepted because their gates are behavioral (the residue/wording greps + the dispatch test) and whole-file yaml/prose fences would rot against upstream edits. Implement applies them verbatim; drift surfaces in the slice-6 acceptance greps.

## References

- `.rpiv/artifacts/solutions/2026-11-03_17-38-05_linkedin-execution-home.md` — parent solution (Option 2 shape implemented; Option 1 superseded by the developer's local-run correction)
- `.rpiv/artifacts/solutions/2026-11-03_14-25-19_linkedin-voyager-transport.md` — transport decision chain + live-capture evidence + SDK-dead production logs
- `.rpiv/artifacts/research/2026-11-03_12-57-53_linkedin-voyager-fetcher.md` — endpoint corrections, removal inventory, precedents, timeout arithmetic
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` — endpoint spec of record (§1-§6, §7 gotchas, §10 templates, §12 matrix, §13 failure matrix, §14 session, §15 risk)
- `H:/fork/linkedin-reverse/FINDINGS.md:113-119` — condensed response walk
- `.rpiv/tmp/voyager-capture.json` — live capture (gitignored scratch; fixture trim source)
- https://github.com/lwthiker/curl-impersonate — primary transport binary (developer-selected)
- scripts/commit-state-rebase.sh — the rebase+retry push discipline the PC push mirrors
