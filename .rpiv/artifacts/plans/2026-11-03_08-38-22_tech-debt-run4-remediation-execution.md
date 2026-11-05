---
date: 2026-11-03T08:38:22+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Tech-debt run #4 remediation execution (N010-N017) as five gated commits"
tags: [plan, tech-debt, linkedin-cutover, commit-slicing, credential-guard, n013-park-guard]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-03_08-01-55_tech-debt-run4-remediation-execution.md
phase_count: 5
phases:
  - { n: 1, title: Credential guard (N010), files: [.gitignore], depends_on: [] }
  - { n: 2, title: SDK module slice (N012a, N013, N014), files: [src/fetch-linkedin-api.ts, src/config.ts, tests/fetch-linkedin-api.test.ts], depends_on: [1] }
  - { n: 3, title: Rewiring slice (N012b), files: [src/fetch-threads.ts, src/index.ts, src/threads-session.ts, src/config-file.ts, scripts/linkedin-login.ts, src/fetch-linkedin.ts, src/linkedin-login.ts, tests/config-file.test.ts, tests/fetch-threads.test.ts, tests/index.test.ts, tests/session.test.ts, tests/fetch-linkedin.test.ts, tests/linkedin-login.test.ts], depends_on: [2] }
  - { n: 4, title: Workflow and lockfile slice, files: [.github/workflows/watch.yml, src/judge.ts, package.json, package-lock.json], depends_on: [3] }
  - { n: 5, title: Docs and guidance slice (N015, N017), files: [AGENTS.md, .claude/skills/validate-e2e/SKILL.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, README.md, .rpiv/artifacts/TECH_DEBT_AUDIT.md, .rpiv/guidance/, .rpiv/artifacts/], depends_on: [4] }
unresolved_phase_count: 0
last_updated: 2026-11-03T11:45:49+0700
last_updated_by: Yogiswara Utama
last_updated_note: "fix desired-end-state fence to the as-run four commits; correct the phase-4 p.lint snippet to p.scripts.lint"
---

# Tech-debt run #4 remediation (N010-N017) Implementation Plan

## Overview

Turn the uncommitted LinkedIn SDK cutover plus the audit run #4 findings into five reviewable, individually green commits: guard the exposed credential first (N010), then land the cutover in four whole-file slice commits with each fix (N012/N013/N014) baked into its file-home slice, close with docs/guidance (N015, N017 note) and the artifact trail. Gates (typecheck / lint / test) run between slices; the PR description carries the N016 operator checklist. Approach per the parent solutions doc Option 1 (FRD four-slice fold).

## Requirements

- N010 lands before any sweep-style staging: restore the linkedin-state*.b64 ignore rule at the run.log boundary and delete the untracked blob (rm only — the blob is untracked, never committed).
- The cutover lands in reviewable slices; every slice is green under npm run typecheck / npm run lint / npm test before its commit.
- N012 (three unexports, split by file home), N013 (fail-safe parked-workflow guard + red-first test), N014 (call-through spy port), N015 (AGENTS.md sync), and the N017 accept-and-document guidance note land inside the same five commits.
- N016 (delete four orphaned LINKEDIN_* GitHub secrets, revoke the PAT) rides the PR description as an operator checklist — no code.
- Commit messages follow the repo's conventional-commit style (developer-confirmed).
- Push all five commits, then open the PR (CI tests the PR head only — no intermediate-push window for the TS2307 lockfile gap).

## Current State Analysis

Working tree at ecc9865 on feature/add-support-for-linkeind carries the entire cutover uncommitted (git status --porcelain, 2026-11-03): 20 modified, 5 deleted, 2 untracked source paths (src/fetch-linkedin-api.ts ~255 lines, tests/fetch-linkedin-api.test.ts ~341 lines), linkedin-state.b64 untracked at root, plus the untracked .rpiv/artifacts trail. watcher.config.json is NOT modified (HEAD already carries the linkedin surfaces at :30-31).

### Key Discoveries

- .gitignore working tree (8 lines): the linkedin-state*.b64 rule is deleted; HEAD holds it at :8 between slice*-recon/ and run.log. The blob (3,852 bytes) is NOT in git history — exposure is one habituated git add . away.
- src/fetch-linkedin-api.ts:179: the parked guard matches ONLY pendingReason === "outsideWorkingHours"; any future reason falls through to result() which polls to completion (possibly the next working day) and only the 8-minute job cap backstops it. Widening prescribed by TECH_DEBT_AUDIT.md:28; two-arm message developer-confirmed (existing parked test tests/fetch-linkedin-api.test.ts:279-293 pins "outside Linked API working hours" + the message detail and stays untouched).
- N012: three unused exports (knip): createLinkedApiClient (src/fetch-linkedin-api.ts:107, sole consumer is the default clientFactory param at :152, zero external references — agent-verified), makeChromiumContextFactory (src/fetch-threads.ts:129) and chromiumContextFactory (src/fetch-threads.ts:180, consumed only as default params at :206/:297).
- N014: captureLines (tests/fetch-linkedin-api.test.ts:93-106) silences console by direct reassignment — the repo idiom is inline t.mock.method call-through at 11 sites (tests/session.test.ts:65, tests/fetch-threads.test.ts:304/:410, tests/index.test.ts:547+), no shared helper, no MockMethod type imports (agent-verified). The silent-resolver test (:122-139) repeats the violation.
- src/config.ts:16-17 already carries the ENV_NAMES linkedApiToken/linkedApiIdentificationToken keys in the working tree; HEAD lacks them — the new module imports these keys, so config.ts must ride the module's slice or that slice cannot typecheck.
- src/judge.ts (:98-110 comment) mirrors watch.yml's timeout-envelope arithmetic — the pair rides one slice.
- The guidance mirror .rpiv/guidance/src/architecture.md pins the parked contract at :78 ("pendingReason \"outsideWorkingHours\"") and already carries 39 changed slice-5 lines — the widen rides the docs slice (whole-file staging; hunk-level add -p is the flaw being removed).
- .rpiv/guidance/.github/workflows/architecture.md:75 carries the F021 accepted-cost paragraph — the N017 accept-and-document note lands directly after it.
- AGENTS.md is untouched by the cutover (absent from git status) — N015 edits are TO BE WRITTEN, not staged: "on Threads" → "on Threads and LinkedIn", a fetch-linkedin-api module bullet, npm start env mention.
- package.json:21 pins @linkedapi/node ^2.3.20 (only new runtime entry); package-lock.json gains 7 lines. The lockfile lacks the package until the workflow slice — slices 2-3 pushed alone would fail CI typecheck (TS2307 at src/fetch-linkedin-api.ts:114).
- lint-staged runs Biome autofix mid-commit — run npx biome check --write on slice paths before staging and review hook output.
- state/seen-posts.json is currently unmodified — it stays out of every slice (the workflow commit-back owns it).

## Desired End State

Reviewer-side view after the plan executes:

```bash
git log --oneline -4   # newest first — FOUR commits as run (see Follow-up 2026-11-03_11-45-49)
# <sha> docs: sync readme, agents, guidance, and audit for the sdk cutover
# <sha> feat: drive linkedin sdk runs from watch.yml via the linked api token pair
# <sha> refactor: rewire threads fetcher seams and delete the linkedin-login fallback
# <sha> feat: add linked api sdk post-search fetcher with fail-safe park guard

git status --porcelain             # empty (state/seen-posts.json only when a run wrote it)
git check-ignore linkedin-state.b64 && echo ignored   # ignored; blob absent from root
npx knip                            # no unused-export rows for the three factories
```

The PR opened on feature/add-support-for-linkeind states the @linkedapi/node dependency need and carries the N016 checklist (delete LINKEDIN_SESSION_STATE / LINKEDIN_EMAIL / LINKEDIN_PASSWORD / LINKEDIN_SECRET_WRITER from Actions secrets; revoke the PAT). Committed guidance and code agree on the parked contract: ANY non-null pendingReason parks.

## What We're NOT Doing

- N005 judge-dispatch split (deferred by its own prescription).
- Probe ramp tests; reasoning_effort endpoint verification.
- A knip CI gate — knip stays an ad hoc acceptance run.
- AGENTS.md npm-start env-list generalization beyond the audit's named spots (checkpoint decision in research: later pass).
- Negative-delta commit wording experiments.
- N016 as code — it is an operator action recorded in the PR description.
- Any change to state/seen-posts.json, watcher.config.json, or scripts/commit-state-rebase.sh.
- hunk-level git add -p anywhere — whole-file staging only.

## Decisions

### Commit messages follow the repo's conventional-commit style

git log shows one style throughout (ecc9865 docs:, ad66f02 feat:, defb8af fix:, lowercase imperative). Directional confirm 1: follow. The five messages are fixed in Ordering Constraints.

### N014 port is fully inline (no new helper)

Directional confirm 2: the repo idiom is t.mock.method(console, ...) + inline .mock.calls.map((call) => call.arguments.join(" ")) at 11 sites; no spyLines helper, no MockMethod imports exist (agent sweep). captureLines and its 9 call sites plus the silent-resolver test port inline; 8 tests need a spy, 1 (order/dedupe) needs none.

### N013: any non-nullish pendingReason parks; two-arm warn; existing parked test untouched

Developer-confirmed against TECH_DEBT_AUDIT.md:28 ("special-casing the working-hours message"). Arm 1 keeps the current line verbatim for outsideWorkingHours (pinned fragments in tests/fetch-linkedin-api.test.ts:279-293 stay green); arm 2 prints parked (pendingReason: <reason>). Explicit === undefined || === null checks, not == null (file style :181-183, Biome).

### Fix placement: folded into file-home slices (solutions Option 1)

Parent solutions locked Opt 1 over fixes-after (Opt 2: hazard window + guidance contradiction + 21 gate rounds) and single-squash (Opt 3: unreviewable mega-diff, 3/3 precedent cautionary). N012 split by file home: createLinkedApiClient in the module slice; the make/chromium pair in the rewiring slice.

### Guidance mirror widen rides the docs slice

.rpiv/guidance/src/architecture.md already carries 39 changed docs-slice lines; staging it earlier drags them or forces add -p (adjustment 1 in the parent doc). Cost: a branch-internal guidance/code contradiction window from the module slice until the docs slice — accepted, closed at slice 5 or squash-merge.

### Push all five commits, then open the PR

CI tests the PR head only; slices 2-3 cannot pass CI alone (TS2307: the lockfile lacks @linkedapi/node until the workflow slice). Parent doc Risk; mitigation adopted as a fixed step.

## Phase 1: Credential guard (N010)

### Overview

Restore the linkedin-state*.b64 ignore rule at its HEAD position and delete the untracked blob; commit the one-line guard BEFORE anything is staged. Depends on nothing — foundation; every later phase stages behind this guard.

### Changes Required:

#### 1. .gitignore

**File**: .gitignore
**Changes**: MODIFY — re-insert the linkedin-state*.b64 rule between slice*-recon/ and run.log (HEAD :8 position; the working tree deleted it). Final file content:

```text
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
linkedin-state*.b64
run.log
```
#### 1. linkedin-state.b64 (delete)

**File**: linkedin-state.b64
**Changes**: DELETE — rm the untracked 3,852-byte blob; its consumer (the LinkedIn refresh hand-off) is deleted by this cutover. Never committed; removal is working-tree hygiene only.

```bash
rm linkedin-state.b64
```

#### 1. commit

**File**: (git — the phase deliverable)
**Changes**: COMMIT — explicit-path staging; the guard commit lands before anything else is staged.

```bash
git add .gitignore
git commit -m "fix: gitignore linkedin-state session blobs"
```
### Success Criteria:

#### Automated Verification:
- [x] Rule present between its HEAD neighbors: `grep -n "linkedin-state" .gitignore` returns line 8, with slice*-recon/ at :7 and run.log at :9
- [x] Blob gone from the tree: `ls linkedin-state.b64` exits 1
- [x] Ignore effective: `git check-ignore linkedin-state.b64` exits 0
- [x] Guard commit is HEAD: `git log --oneline -1` shows "fix: gitignore linkedin-state session blobs" — SKIPPED per developer decision 2026-11-03: the rule was already committed at HEAD (:8); restoring the working tree left zero diff, so the commit is verify-only and the branch lands 4 commits
- [x] Gates pass: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:
- [x] `git status --porcelain` lists no linkedin-state.b64 entry (the untracked row is gone)

## Phase 2: SDK module slice (N012a, N013, N014)

### Overview

Land the new SDK fetcher + its offline suite + the ENV_NAMES keys it imports, with N013 (nullish-pendingReason park, two-arm warn, red-first demonstration), N014 (inline call-through spy port), and N012a (drop export on createLinkedApiClient) baked in. Depends on Phase 1; purely additive over HEAD plus the config keys.

### Changes Required:

#### 2. src/fetch-linkedin-api.ts

**File**: src/fetch-linkedin-api.ts
**Changes**: NEW (untracked cutover file, committed here) + MODIFY — drop export on createLinkedApiClient; widen the parked guard (:175-186) to any non-nullish pendingReason with the two-arm warn.

```ts
// src/fetch-linkedin-api.ts — two changes on the cutover file (everything
// else in the ~255-line file is committed verbatim from the working tree).

// CHANGE 1 (:102-108): drop the export keyword on the SDK client factory —
// its only consumer is the default clientFactory param of fetchLinkedInPosts
// (:152); knip flags the export as unused (N012a). The doc comment above the
// declaration stays verbatim.
async function createLinkedApiClient(
  tokens: LinkedInApiTokens,
): Promise<LinkedApiClientLike> {
  // body unchanged from the working-tree file (the dynamic NAMED import and
  // the one sanctioned SDK-boundary cast)
}

// CHANGE 2 (:175-186): the parked-workflow guard — the strict
// === "outsideWorkingHours" block (comment + code) is replaced wholesale:
      // Default account policy PARKS the workflow — pendingReason carries the
      // cause. ANY non-null reason parks: the SDK docs pin "outsideWorkingHours"
      // today, but the field exists so the account policy can defer for other
      // causes too. Never await result() on a parked workflow: result() polls
      // to completion — possibly the next working day — and the 8-minute job
      // cap would kill the whole run. The skip costs one execute() round-trip
      // (working-hours.md, 2026-11-01); a false skip costs one surface-tick,
      // a false fall-through costs the run.
      if (
        workflow.pendingReason !== undefined &&
        workflow.pendingReason !== null
      ) {
        const reason = workflow.pendingReason;
        const detail =
          workflow.message === undefined || workflow.message === null
            ? ""
            : ` (${workflow.message})`;
        const cause =
          reason === "outsideWorkingHours"
            ? "outside Linked API working hours"
            : `parked (pendingReason: ${reason})`;
        console.warn(`fetch: ${label} skipped — ${cause}${detail}`);
        continue;
      }
```
#### 2. tests/fetch-linkedin-api.test.ts

**File**: tests/fetch-linkedin-api.test.ts
**Changes**: NEW (untracked cutover file, committed here) + MODIFY — add the N013 red test; port captureLines + the silent-resolver test to inline t.mock.method call-through spies (N014).

```ts
// tests/fetch-linkedin-api.test.ts — three change groups on the cutover
// suite (N013 red test; N014 spy port). Unchanged tests are committed
// verbatim from the working tree.

// GROUP A (import list): DROP the now-unused Post type import — captureLines
// was its only consumer; every posts binding below is inferred.
//   import type { Post } from "../src/types.js";   // DELETE this line

// GROUP B: DELETE the captureLines helper (:93-106) wholesale — the repo
// idiom is inline t.mock.method call-through spies (16 sites; no helper,
// no MockMethod import). The it() bodies it wrapped are ported below.

// GROUP C (ported + new tests, verbatim):

  it("returns null silently when either token is unset or blank", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    assert.equal(resolveLinkedApiTokens({}), null);
    assert.equal(resolveLinkedApiTokens({ LINKED_API_TOKEN: "a" }), null);
    assert.equal(
      resolveLinkedApiTokens({ LINKED_API_TOKEN: "a", LINKED_API_IDENTIFICATION_TOKEN: "  " }),
      null,
    );
    assert.equal(warns.mock.calls.length, 0, "the resolver is silent; the caller owns the warn");
  });

  it("maps results in SDK order and dedupes re-mints by id", async () => {
    const first = resultItem();
    const dupe = resultItem({ text: "same urn, different text" });
    const second = resultItem({
      activityUrn: "urn:li:activity:7440011668937568258",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568258",
      time: "2026-11-01T09:30:00Z",
    });
    const { client } = stubClient({ data: [first, dupe, second] });
    const posts = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      ["urn:li:activity:7440011668937568257", "urn:li:activity:7440011668937568258"],
    );
  });

  it("treats an empty result as success: [] plus an OK 0-post log", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const { client } = stubClient({ data: [] });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.deepEqual(value, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("OK — 0 post(s)")));
  });

  it("warns and skips every surface whose execute() throws — the loop continues", async (t) => {
    // One client per run (one Linked API instance per account): a thrown
    // request-level error degrades BOTH surfaces, neither stops the loop.
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const failing = stubClient({
      executeError: Object.assign(new Error("The provided token is invalid"), {
        type: "invalidLinkedApiToken",
      }),
    });
    const second = { type: "linkedin", value: "#hiring" } as const;
    const value = await fetchLinkedInPosts([SURFACE, second], TOKENS, () =>
      Promise.resolve(failing.client),
    );
    assert.deepEqual(value, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const failed = lines.filter((line) =>
      line.includes("FAILED — invalidLinkedApiToken: The provided token is invalid"),
    );
    assert.equal(failed.length, 2, "both surfaces warn with the typed cause");
  });

  it("delivers posts from a healthy surface alongside a failing one", async (t) => {
    // The seam varies behavior per execute() call (stateful double): the
    // first call throws, the second returns data — the run keeps the second
    // surface's posts.
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const calls: Array<{ type: string; message: string } | null> = [
      { type: "searchingNotAllowed", message: "LinkedIn has blocked performing the search." },
      null,
    ];
    let call = 0;
    const client: LinkedApiClientLike = {
      searchPosts: {
        execute: async () => {
          // noUncheckedIndexedAccess: index reads add undefined — normalize
          // to the T|null the guard checks (extract.ts match[1] ?? "" idiom).
          const failure: { type: string; message: string } | null = calls[call] ?? null;
          call += 1;
          if (failure !== null) {
            throw Object.assign(new Error(failure.message), { type: failure.type });
          }
          return {
            workflowId: "wf-2",
            workflowStatus: "running",
          };
        },
        result: async () => ({
          data: [resultItem({ activityUrn: "urn:li:activity:111", url: "https://u/111" })],
          errors: null,
        }),
      },
    };
    const healthy = { type: "linkedin", value: "#hiring" } as const;
    const value = await fetchLinkedInPosts([SURFACE, healthy], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.equal(value.length, 1, "the failed surface skips, the healthy one delivers");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("linkedin/#hiring react FAILED")));
  });

  it("warns result().errors[] entries and keeps the posts collected so far", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client } = stubClient({
      data: [resultItem({ activityUrn: "urn:li:activity:222", url: "https://u/222" })],
      errors: [{ type: "filterNotApplied", message: "fromMembers: no match" }],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.equal(value.length, 1);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("filterNotApplied: fromMembers: no match")));
  });

  it("skips a parked workflow without awaiting result()", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client, resultCalls } = stubClient({
      executeResult: {
        pendingReason: "outsideWorkingHours",
        message: "starts when working hours open at Mon, 09:00",
      },
      data: [resultItem()],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.deepEqual(value, [], "a parked workflow contributes no posts");
    assert.deepEqual(resultCalls, [], "result() is never awaited on a parked workflow");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("outside Linked API working hours")));
    assert.ok(lines.some((line) => line.includes("starts when working hours open")));
  });

  it("parks on any pendingReason, not just outsideWorkingHours, without awaiting result()", async (t) => {
    // N013 red-first: this test FAILS against the strict === guard (result()
    // gets awaited, posts non-empty) and PASSES once the guard widens to any
    // non-nullish pendingReason. Two-arm message: the generic arm names the
    // reason ("parked (pendingReason: <reason>)"); the working-hours arm keeps
    // its existing line (see the test above).
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client, resultCalls } = stubClient({
      executeResult: {
        pendingReason: "accountUnderReview",
        message: "try again later",
      },
      data: [resultItem()],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.deepEqual(value, [], "an unrecognized pendingReason still parks: no posts");
    assert.deepEqual(resultCalls, [], "result() is never awaited on a parked workflow");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => line.includes("pendingReason: accountUnderReview")),
      `no parked-reason warn in: ${JSON.stringify(lines)}`,
    );
    assert.ok(lines.some((line) => line.includes("try again later")));
  });

  it("drops malformed rows with a count and a conditional warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const good = resultItem({ activityUrn: "urn:li:activity:333", url: "https://u/333" });
    const { client } = stubClient({ data: [resultItem({ author: null }), good] });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.equal(value.length, 1);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("dropped 1 malformed result(s)")));
  });

  it("survives a thrown null — describeError guards non-Error throws", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const failing = stubClient({ executeError: null });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(failing.client),
    );
    assert.deepEqual(value, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("FAILED — null")), "thrown null degrades");
  });

  it("degrades to warn + [] when the client factory itself rejects", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.reject(new Error("install broken")),
    );
    assert.deepEqual(value, [], "a factory fault contributes no posts and never rejects");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("linkedin client FAILED — install broken")));
    assert.ok(
      !lines.some((line) => line.includes("linkedin/#hiring react")),
      "no surface runs when the client cannot build",
    );
  });

  it("passes the term verbatim with the pinned search shape", async () => {
    const { client, executeParams } = stubClient({ data: [] });
    await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.equal(executeParams.length, 1);
    assert.deepEqual(executeParams[0], {
      term: "#hiring react",
      limit: 100,
      filter: { sort: "latest", datePosted: "past24Hours" },
    });
  });
```
#### 2. src/config.ts

**File**: src/config.ts
**Changes**: MODIFY — ENV_NAMES gains linkedApiToken + linkedApiIdentificationToken (already in the working tree; staged here because the new module imports these keys and HEAD lacks them).

```ts
// src/config.ts — ENV_NAMES gains the Linked API pair (:16-17). Everything
// else in the file is unchanged; HEAD lacks these two keys, which is why this
// file must ride the module's slice (src/fetch-linkedin-api.ts imports them
// via ENV_NAMES — slice 2 cannot typecheck without them).
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedApiToken: "LINKED_API_TOKEN",
  linkedApiIdentificationToken: "LINKED_API_IDENTIFICATION_TOKEN",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

#### 2. commit

**File**: (git — the phase deliverable)
**Changes**: COMMIT — explicit 3-path staging after the biome pre-pass.

```bash
# before staging: pre-empt the lint-staged hook's autofix on the slice paths
npx biome check --write src/fetch-linkedin-api.ts src/config.ts tests/fetch-linkedin-api.test.ts
git add src/fetch-linkedin-api.ts src/config.ts tests/fetch-linkedin-api.test.ts
git commit -m "feat: add linked api sdk post-search fetcher with fail-safe park guard"
```
### Success Criteria:

#### Automated Verification:
- [x] Full linkedin suite green: `npx tsx --test tests/fetch-linkedin-api.test.ts`
- [x] No silencing stub remains: `grep -n "console[method]" tests/fetch-linkedin-api.test.ts` exits 1 (no matches), and `grep -c "t.mock.method(console" tests/fetch-linkedin-api.test.ts` returns >= 9
- [x] No unused export: `npx knip` reports no createLinkedApiClient row (ad hoc acceptance; the fetch-threads rows legitimately remain until Phase 3)
- [x] Existing parked test survives with only the spy port: its two pinned fragments ("outside Linked API working hours", "starts when working hours open") still pass in `npx tsx --test tests/fetch-linkedin-api.test.ts`
- [x] Gates pass: `npm run typecheck && npm run lint && npm test`
- [x] Slice commit is HEAD with exactly 3 paths: `git show --stat --oneline HEAD` lists src/fetch-linkedin-api.ts, src/config.ts, tests/fetch-linkedin-api.test.ts

#### Manual Verification:
- [x] Red-first demonstration (transient, pre-widening): with the strict `=== "outsideWorkingHours"` guard still in place, `npx tsx --test tests/fetch-linkedin-api.test.ts` fails ONLY "parks on any pendingReason..."; after applying the widened guard the same command is green. The committed state is the widened, green one
- [x] Generic-arm warn reads as designed: `parked (pendingReason: accountUnderReview) (try again later)`

## Phase 3: Rewiring slice (N012b)

### Overview

Land the deletions and the rewired src/tests: index.ts dispatch, threads-session/config-file slim-downs, fetch-threads.ts with N012b (drop export on the make/chromium factory pair), and the four rewired offline suites. Depends on Phase 2 (suites exercise the module seam landed there); committing src without its suites would leave HEAD red, so the pair rides together.

### Changes Required:

#### 3. src/fetch-threads.ts

**File**: src/fetch-threads.ts
**Changes**: MODIFY — cutover slim-down (LinkedIn dispatch removed) plus N012b: drop export on makeChromiumContextFactory (:129) and chromiumContextFactory (:180); both stay live as default-param factories (:206, :297).

```ts
// src/fetch-threads.ts — N012b on top of the cutover slim-down (the ~96-line
// LinkedIn-dispatch removal is already in the working tree and is committed
// verbatim). Two export keywords drop; both factories stay live as the
// in-module default params at :206 and :297, so tests keep injecting
// fakeContextFactory and production keeps chromiumContextFactory.

// (:129 — the ONLY Playwright import site lives inside this factory's body;
// its doc comment stays verbatim)
function makeChromiumContextFactory(headless: boolean): ContextFactory {
  // body unchanged
}

// (:180)
const chromiumContextFactory: ContextFactory = makeChromiumContextFactory(true);
```
#### 3. src/index.ts, src/threads-session.ts, src/config-file.ts

**File**: src/index.ts, src/threads-session.ts, src/config-file.ts
**Changes**: MODIFY — the cutover rewiring already in the working tree (linkedin surfaces dispatch to the SDK fetcher; login-fallback plumbing removed; config-file linkedin surface validation per its 43-line diff).

```bash
# src/index.ts, src/threads-session.ts, src/config-file.ts — the cutover
# rewiring ALREADY CORRECT in the working tree; committed verbatim here.
#
# - index.ts: linkedin surfaces dispatch to fetchLinkedInPosts(resolveLinked
#   ApiTokens...) with the one missing-token warn; login-fallback plumbing gone
# - threads-session.ts: THREADS_SESSION_STATE-only (12-line diff vs HEAD)
# - config-file.ts: linkedin surface validation per its 43-line diff
#
# No paste step — verify each file still matches the working tree, then stage:
git diff --stat -- src/index.ts src/threads-session.ts src/config-file.ts   # 248/12/43-line shape vs HEAD
git add src/index.ts src/threads-session.ts src/config-file.ts
```
#### 3. Deletions (5 paths)

**File**: scripts/linkedin-login.ts, src/fetch-linkedin.ts, src/linkedin-login.ts, tests/fetch-linkedin.test.ts, tests/linkedin-login.test.ts
**Changes**: DELETE — deletions are UNSTAGED in the working tree (git status shows ` D`, unstaged); `git add` on the deleted paths records them in this commit alongside the rewiring.

```bash
# The five deletions are UNSTAGED in the working tree (git status shows ` D`).
# `git add <path>` on a deleted path records the removal — explicit paths only:
git add scripts/linkedin-login.ts src/fetch-linkedin.ts src/linkedin-login.ts tests/fetch-linkedin.test.ts tests/linkedin-login.test.ts
# staged-state sanity: `git status --porcelain` now shows these five as `D ` (staged D, no space-D)
```
#### 3. Rewired test suites (4 paths)

**File**: tests/config-file.test.ts, tests/fetch-threads.test.ts, tests/index.test.ts, tests/session.test.ts
**Changes**: MODIFY — the rewired offline suites already in the working tree; explicit factory injection replaces the deleted exports' import sites.

```bash
# tests/config-file.test.ts, tests/fetch-threads.test.ts, tests/index.test.ts,
# tests/session.test.ts — the four rewired offline suites ALREADY CORRECT in
# the working tree; committed verbatim. Explicit factory injection replaces
# the deleted exports' import sites; no suite imports makeChromiumContextFactory
# or chromiumContextFactory (knip's 3-unused-export finding proves it).
git add tests/config-file.test.ts tests/fetch-threads.test.ts tests/index.test.ts tests/session.test.ts
```

#### 3. commit

**File**: (git — the phase deliverable)
**Changes**: COMMIT — 13 explicit paths (8 modify, 5 delete) after the biome pre-pass.

```bash
npx biome check --write src/fetch-threads.ts src/index.ts src/threads-session.ts src/config-file.ts tests/config-file.test.ts tests/fetch-threads.test.ts tests/index.test.ts tests/session.test.ts
git add src/fetch-threads.ts
git add scripts/linkedin-login.ts src/fetch-linkedin.ts src/linkedin-login.ts tests/fetch-linkedin.test.ts tests/linkedin-login.test.ts
git add src/index.ts src/threads-session.ts src/config-file.ts tests/config-file.test.ts tests/fetch-threads.test.ts tests/index.test.ts tests/session.test.ts
git commit -m "refactor: rewire threads fetcher seams and delete the linkedin-login fallback"
# sanity: `git show --stat --oneline HEAD` lists exactly 13 paths (8 modify, 5 delete)
```
### Success Criteria:

#### Automated Verification:
- [x] Gates pass with the five deleted suites gone and four rewired suites in: `npm run typecheck && npm run lint && npm test`
- [x] No unused exports remain for this pair: `npx knip` reports no makeChromiumContextFactory / chromiumContextFactory rows
- [x] No import site remains: `grep -rn "chromiumContextFactory\|makeChromiumContextFactory" src/ tests/ scripts/ | grep -E "import |require\("` exits 1 — after the unexport, the only matches outside src/fetch-threads.ts are prose comments (e.g. src/index.ts:112 "Default: chromiumContextFactory."), never an import/require line
- [x] Slice commit is HEAD with exactly 13 paths: `git show --stat --oneline HEAD` lists the 8 modified + 5 deleted paths
- [x] Staged deletions recorded: before the commit, `git status --porcelain | grep "^D "` shows the five deletion paths (staged `D `, not unstaged ` D`)

#### Manual Verification:
- [x] The suite run prints the rewired suites' test names (index.test.ts exercises the linkedin skip-with-warn path) — no linkedin-login tests remain

## Phase 4: Workflow and lockfile slice

### Overview

Land watch.yml (token-pair env swap, concurrency flip, refresh-step removal, commit-back simplification), src/judge.ts (the mirrored timeout-envelope comment), package.json (dependency + lint scope), package-lock.json. Depends on Phase 3; the lockfile entry is what makes the branch CI-clean at its head.

### Changes Required:

#### 4. .github/workflows/watch.yml

**File**: .github/workflows/watch.yml
**Changes**: MODIFY — already in the working tree: LINKEDIN_* env block replaced by LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN, cancel-in-progress flip, refresh-step removal, state-only commit-back.

```bash
# .github/workflows/watch.yml — the cutover diff ALREADY CORRECT in the
# working tree; committed verbatim. Ground-truth diff vs HEAD (74 lines changed):
#   - concurrency: cancel-in-progress flips to true with the park-cap comment
#   - judge env comment: fetch term marked PENDING MEASUREMENT (SDK workflows)
#   - env block: LINKEDIN_SESSION_STATE/LINKEDIN_EMAIL/LINKEDIN_PASSWORD and the
#     LINKEDIN_SECRET_WRITER refresh step are REPLACED by the LINKED_API_TOKEN /
#     LINKED_API_IDENTIFICATION_TOKEN pair (names match ENV_NAMES exactly)
#   - Commit state step: state-only add (no linkedin-login.json marker branch)
git diff --stat -- .github/workflows/watch.yml   # expect ~74 lines changed
git add .github/workflows/watch.yml
```
#### 4. src/judge.ts

**File**: src/judge.ts
**Changes**: MODIFY — already in the working tree: the WAIT_BUDGET_MS comment mirrors watch.yml's fetch-term arithmetic (pending measurement note).

```bash
# src/judge.ts — the WAIT_BUDGET_MS comment mirror (12-line diff vs HEAD):
# the timeout-envelope arithmetic drops the 71s Threads-fetch term and marks
# the fetch term PENDING MEASUREMENT for the SDK workflows, mirroring watch.yml.
# This is the 'mirrored concurrency contract' — it rides the same commit as the
# workflow so the two comments cannot drift apart in history.
git diff -- src/judge.ts   # expect comment-only change, no code change
git add src/judge.ts
```
#### 4. package.json + package-lock.json

**File**: package.json, package-lock.json
**Changes**: MODIFY — already in the working tree: @linkedapi/node ^2.3.20 dependency, lint scope drops scripts/linkedin-login.ts, lockfile gains the 7 SDK lines.

```bash
# package.json + package-lock.json — already correct in the working tree:
#   - dependencies gain "@linkedapi/node": "^2.3.20" (the PR states the need:
#     the Linked API SDK replaces the blocked Playwright LinkedIn walker)
#   - lint script drops scripts/linkedin-login.ts (deleted in Phase 3)
#   - lockfile: 7 added lines (:11 dependencies entry + :633-638 entry block)
# Verify the lockfile actually contains the package before staging (TS2307 guard):
# NOTE: bare substring on purpose — the quoted form matches only :11 because
# the node_modules key and resolved URL are /-preceded:
grep -c '@linkedapi/node' package-lock.json   # >= 3 (:11 key, :633 node_modules key, :635 resolved URL)
git add package.json package-lock.json
```

#### 4. commit

**File**: (git — the phase deliverable)
**Changes**: COMMIT — 4 explicit paths; closes the TS2307 push-window at the branch head.

```bash
# no biome pre-pass targets here: watch.yml is yaml, judge.ts/package.json are
# lint-clean in the tree, package-lock.json is generated — run the scoped check
# anyway for the TS file so the lint-staged hook has nothing to autofix:
npx biome check --write src/judge.ts
git add .github/workflows/watch.yml src/judge.ts package.json package-lock.json
git commit -m "feat: drive linkedin sdk runs from watch.yml via the linked api token pair"
# sanity: `git show --stat --oneline HEAD` lists exactly 4 paths
```
### Success Criteria:

#### Automated Verification:
- [x] Gates pass (the lockfile now carries @linkedapi/node, so the dynamic import at src/fetch-linkedin-api.ts:114 resolves under tsc): `npm run typecheck && npm run lint && npm test`
- [x] The four orphaned LINKEDIN_* names are gone from the workflow: `grep -n "LINKEDIN_" .github/workflows/watch.yml` exits 1
- [x] The token pair is mapped with ENV_NAMES-exact names: `grep -c "LINKED_API_TOKEN\|LINKED_API_IDENTIFICATION_TOKEN" .github/workflows/watch.yml` returns >= 2, and the names equal src/config.ts ENV_NAMES entries (grep both files)
- [x] The judge mirror landed: `grep -n "PENDING MEASUREMENT" src/judge.ts` returns the WAIT_BUDGET_MS comment block
- [x] Dependency + lint scope recorded: `node -e "const p=require('./package.json');if(!p.dependencies['@linkedapi/node']||p.scripts.lint.includes('linkedin-login'))process.exit(1)"` exits 0 (the lint script lives at p.scripts.lint — see Follow-up 2026-11-03_11-45-49)
- [x] Lockfile carries the package (TS2307 closed at the branch head): `grep -c '@linkedapi/node' package-lock.json` returns >= 3 (dependencies key :11, node_modules key :633, resolved URL :635)
- [x] Slice commit is HEAD with exactly 4 paths: `git show --stat --oneline HEAD`

#### Manual Verification:
- [x] The commit-back step still adds ONLY state/seen-posts.json (no linkedin-login.json branch), and the concurrency comment explains why cancel keeps the state read-modify-write serialized
- [x] Yaml validity confirmed without a new toolchain: run actionlint (or any yaml linter) on .github/workflows/watch.yml if available; otherwise eyeball the indentation of the three hand-edited blocks (concurrency, env, Commit state) — this yaml was authored in the cutover and has never been executed by Actions, so a syntax error would first fire at the post-merge cron tick — actionlint not installed; eyeball fallback used, all three blocks well-formed

## Phase 5: Docs and guidance slice (N015, N017)

### Overview

Land the doc layer: AGENTS.md two-platform sync (N015 — the only doc the cutover missed), the guidance :78 parked-contract widen, the N017 accept-and-document note after the F021 paragraph (:75), README + TECH_DEBT_AUDIT.md (already edited in the tree), and the artifact trail including this plan. Depends on Phase 4; closes the guidance/code contradiction window.

### Changes Required:

#### 5. AGENTS.md

**File**: AGENTS.md
**Changes**: MODIFY — N015: "on Threads" → "on Threads and LinkedIn" (:7), add the fetch-linkedin-api module bullet to the Architecture list, npm start env mention gains the token pair.

```diff
@@ AGENTS.md — three edits (the only doc layer the cutover missed; the file
@@ is tracked and UNMODIFIED in the working tree, so these hunks are the
@@ phase's only new code).

@@ :7 — the intro sentence (audit N015 spot 1):
 
-loker-watcher watches Indonesian job-hunting surfaces on Threads. A scheduled
+loker-watcher watches Indonesian job-hunting surfaces on Threads and
+LinkedIn. A scheduled
 GitHub Actions workflow loads the surfaces listed in `watcher.config.json`,

@@ Architecture module list — insert after the fetch-threads/threads-session
@@ bullet (audit N015 spot 2):
 
 - `src/fetch-threads.ts`, `src/threads-session.ts` - Playwright loading of tag,
   profile, and search surfaces; signed-in via `THREADS_SESSION_STATE` with a
   logged-out fallback
+- `src/fetch-linkedin-api.ts` - Linked API SDK post search for the linkedin
+  surfaces; sequential, never throws (degrades per surface), tokens from the
+  `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` pair with the
+  caller-owned skip warn
 - `src/extract.ts` - parses posts from graphql XHR responses or `data-sjs` blobs

@@ Commands list — npm start env mention (audit N015 spot 3):
 
-- `npm start` - run the watcher locally (needs LLM_* and GMAIL_* env vars)
+- `npm start` - run the watcher locally (needs LLM_* and GMAIL_* env vars,
+  plus `LINKED_API_*` for the linkedin surfaces; absent, those surfaces skip
+  with a warn)
```

#### 5. .claude/skills/validate-e2e/SKILL.md

**File**: .claude/skills/validate-e2e/SKILL.md
**Changes**: MODIFY — the parent solutions doc's slice-4 list names this path: the :3 description says the e2e validation runs "against the live Threads feed" — same Threads-only staleness class as N015. One-line fix (developer decision: add).

```diff
@@ .claude/skills/validate-e2e/SKILL.md — the :3 description line (the parent
@@ solutions doc's slice-4 list names it: same Threads-only staleness class as
@@ N015; the e2e validation drives the two-platform pipeline now):
 
-description: Run a full end-to-end validation of the loker-watcher pipeline against the live Threads feed and the real LLM judge endpoint. Use when the user asks to validate, smoke-test, or prove the watcher works before a release or a config change.
+description: Run a full end-to-end validation of the loker-watcher pipeline against the live Threads and LinkedIn feeds and the real LLM judge endpoint. Use when the user asks to validate, smoke-test, or prove the watcher works before a release or a config change.
```
#### 5. .rpiv/guidance/src/architecture.md

**File**: .rpiv/guidance/src/architecture.md
**Changes**: MODIFY — widen the :78 parked-contract line to "ANY non-nullish pendingReason parks" (two-arm warn); rides with the file's 39 already-changed docs-slice lines.

```diff
@@ .rpiv/guidance/src/architecture.md — the :78 parked-contract widen, riding
@@ the file's 39 already-changed docs-slice lines (whole-file staging; hunk-
@@ level add -p is the flaw this plan removes). Mirrors Phase 2's landed guard:
 
-// (pendingReason "outsideWorkingHours") warns and NEVER awaits result(); result().errors[] warns each entry
+// (ANY non-nullish pendingReason parks — "outsideWorkingHours" keeps its dedicated message; any other
+// reason warns "parked (pendingReason: <reason>)") and NEVER awaits result(); result().errors[] warns each entry
```
#### 5. .rpiv/guidance/.github/workflows/architecture.md

**File**: .rpiv/guidance/.github/workflows/architecture.md
**Changes**: MODIFY — add the N017 accept-and-document note directly after the F021 accepted-cost paragraph (:75).

```diff
@@ .rpiv/guidance/.github/workflows/architecture.md — the N017 accept-and-
@@ document note lands directly after the F021 accepted-cost paragraph (:75):
 
 Accepted cost (F021): a skipped state conflict means the next run re-judges — the audit tolerates one duplicate digest. The commit-back is the only production writer to `state/`.
+
+State history growth (N017): accepted and documented (2026-11-03). Every match run rewrites the ~1.6 MB seen-state file; prune keeps the file bounded to the 72h window, but git history accumulates one near-full-file rewrite per run, so clone size and CI checkout cost grow without bound. The policy is (a) accept and document. Revisit when clone size or checkout time becomes a visible cost: (b) periodic squash of state/ commits via git-filter-repo, or (c) move seen-state out of git (cache/artifact; a redesign).
```
#### 5. README.md + .rpiv/artifacts/TECH_DEBT_AUDIT.md + 2 guidance mirrors

**File**: README.md, .rpiv/artifacts/TECH_DEBT_AUDIT.md, .rpiv/guidance/architecture.md, .rpiv/guidance/tests/architecture.md
**Changes**: MODIFY — already in the working tree (README SDK rewrites; audit run-#4 rows; root + tests mirror updates); staged here.

```bash
# README.md + .rpiv/artifacts/TECH_DEBT_AUDIT.md + the two remaining guidance
# mirrors (.rpiv/guidance/architecture.md root, .rpiv/guidance/tests/architecture.md)
# — ALREADY CORRECT in the working tree; committed verbatim (README: the SDK
# rewrites; audit: the run-#4 rows; mirrors: the 4-line updates).
git diff --stat -- README.md .rpiv/artifacts/TECH_DEBT_AUDIT.md .rpiv/guidance/architecture.md .rpiv/guidance/tests/architecture.md
git add README.md .rpiv/artifacts/TECH_DEBT_AUDIT.md .rpiv/guidance/architecture.md .rpiv/guidance/tests/architecture.md

# The untracked artifact trail (incl. the plans/ tree with THIS plan document)
# — .rpiv/tmp/ and .codebase-memory/graph.db.zst are gitignored, so a directory
# add cannot sweep them:
git status --porcelain -- .rpiv/artifacts/ | head -20   # eyeball the untracked set
git add .rpiv/artifacts/
```
#### 5. Untracked .rpiv/artifacts entries + this plan

**File**: .rpiv/artifacts/ (designs/, discover/, handoffs/, plans/, research/, solutions/, validation/ — the plans/ tree holds this plan document)
**Changes**: NEW — the artifact trail; the directory add below covers all of it, including the plans/ tree that holds THIS plan document.

```bash
# the single directory add stages every untracked artifact entry
git add .rpiv/artifacts/
# sanity: git status --porcelain -- .rpiv/artifacts/ shows nothing untracked afterwards
```
### Success Criteria:

#### Automated Verification:
- [x] Gates pass on the finished tree: `npm run typecheck && npm run lint && npm test`
- [x] AGENTS.md synced: `grep -n "Threads and" AGENTS.md` returns the intro line, and `grep -n "fetch-linkedin-api" AGENTS.md` returns the module bullet
- [x] SKILL.md synced: `grep -n "Threads and LinkedIn feeds" .claude/skills/validate-e2e/SKILL.md` returns the description line
- [x] Guidance widen landed: `grep -n "ANY non-nullish pendingReason" .rpiv/guidance/src/architecture.md` returns the parked-contract line
- [x] N017 note landed after the F021 paragraph: `grep -n "F021\|State history growth" .rpiv/guidance/.github/workflows/architecture.md` returns both lines in that order
- [x] Terminal tree state: `git status --porcelain` is empty (no tracked modifications, no untracked leftovers outside gitignored paths)
- [x] All five commits present in order: `git log --oneline -5` lists docs/feat/refactor/feat/fix top-to-bottom — FOUR commits per the Phase 1 developer decision (the fix guard commit had no diff; log is docs/feat/refactor/feat top-to-bottom)
- [x] Slice commit is HEAD: `git show --stat --oneline HEAD` lists AGENTS.md, SKILL.md, README.md, TECH_DEBT_AUDIT.md, the 4 guidance mirrors, and the artifact additions

#### Manual Verification:
- [x] Push succeeded once for all five commits; the PR is open with the N016 checklist and the @linkedapi/node dependency-need statement in its body — FOUR commits pushed (Phase 1 decision); PR #6 already existed for this branch and its stale fallback title/body were updated in place
- [x] `gh pr view` shows the checklist items for all four LINKEDIN_* deletions plus the token-pair creation step

#### 5. commit + push + PR

**File**: (git — the phase deliverable)
**Changes**: COMMIT + TERMINAL — docs commit, then the single push of all five commits, then the PR whose body carries the N016 operator checklist.

```bash
# markdown has no biome target and lint-staged matches *.ts only — no autofix
# is possible on these paths; commit:
git add AGENTS.md .claude/skills/validate-e2e/SKILL.md .rpiv/guidance/src/architecture.md .rpiv/guidance/.github/workflows/architecture.md
git commit -m "docs: sync readme, agents, guidance, and audit for the sdk cutover"
# sanity: `git show --stat --oneline HEAD` lists AGENTS.md, SKILL.md, README.md,
# TECH_DEBT_AUDIT.md, the 4 guidance mirrors, and the .rpiv/artifacts additions

# TERMINAL — push all five commits at once, then open the PR (CI tests the PR
# head only; slices 1-4 pushed alone would fail typecheck before Phase 4's
# lockfile landed):
git push -u origin feature/add-support-for-linkeind

# PR body (write to the ignored scratch dir first):
cat > .rpiv/tmp/pr-body.md << 'EOF'
## LinkedIn SDK post-search cutover (N011) + tech-debt run #4 remediation (N010-N017)

Cuts LinkedIn fetching over from the blocked Playwright walker to the Linked API
SDK. New runtime dependency `@linkedapi/node` ^2.3.20 — stated need: the
Playwright LinkedIn walker was blocked cloud-side; the SDK's two-call
post-search flow replaces it, sequential per FR4.

Five commits, each green under typecheck/lint/test:
1. fix: gitignore linkedin-state session blobs (N010 credential guard)
2. feat: add linked api sdk post-search fetcher with fail-safe park guard (N012a/N013/N014)
3. refactor: rewire threads fetcher seams and delete the linkedin-login fallback (N012b)
4. feat: drive linkedin sdk runs from watch.yml via the linked api token pair
5. docs: sync readme, agents, guidance, and audit for the sdk cutover (N015/N017)

## Operator checklist (N016)

BEFORE the first post-merge cron tick:
- [ ] Create `LINKED_API_TOKEN` and `LINKED_API_IDENTIFICATION_TOKEN` from the Linked API dashboard (absent pair = linkedin surfaces skip with one warn; the run still completes)

AFTER merge (Settings -> Secrets and variables -> Actions):
- [ ] Delete `LINKEDIN_SESSION_STATE`
- [ ] Delete `LINKEDIN_EMAIL`
- [ ] Delete `LINKEDIN_PASSWORD`
- [ ] Delete `LINKEDIN_SECRET_WRITER` (fine-grained PAT — revoke at github.com if it has other uses)
EOF
gh pr create --base main --title "LinkedIn SDK post-search cutover + tech-debt run #4 remediation" --body-file .rpiv/tmp/pr-body.md
```

## Ordering Constraints

Strictly sequential — each commit is the parent of the next:

1. fix: gitignore linkedin-state session blobs (N010 — before any staging)
2. feat: add linked api sdk post-search fetcher with fail-safe park guard (N012a+N013+N014)
3. refactor: rewire threads fetcher seams and delete the linkedin-login fallback (N012b)
4. feat: drive linkedin sdk runs from watch.yml via the linked api token pair
5. docs: sync readme, agents, guidance, and audit for the sdk cutover (N015+N017)

No parallelism: every slice stages whole files that later slices do not re-touch (fixes are pre-baked). Push happens once after commit 5; the PR opens after the push. Phase 2 must precede Phase 3 (suites exercise the module seam); Phase 3 must precede Phase 4 (watch.yml env names match the config keys and fetcher actually landed); Phase 4 must precede Phase 5 (docs describe the landed workflow).

## Verification Notes

- Per slice: npm run typecheck && npm run lint && npm test (read-only, offline, seconds to low minutes).
- Phase 1: git check-ignore linkedin-state.b64 exits 0; ls linkedin-state.b64 fails; git log -1 shows the guard commit before any other new commit.
- Phase 2: red-first demonstration — the new parked-reason test FAILS against the strict === guard, then PASSES after the widening (npx tsx --test tests/fetch-linkedin-api.test.ts). npx knip reports no createLinkedApiClient row.
- Phase 3: npx knip reports no makeChromiumContextFactory / chromiumContextFactory rows; suite count includes the four rewired suites.
- Phase 4: yaml validity is a MANUAL check (actionlint if available, else eyeball the three hand-edited blocks) — Actions never executes watch.yml before the post-merge cron; the Automated content assertions (env names, LINKEDIN_ absence, commit-back shape) pin the risky hunks; LINKED_API_* names match ENV_NAMES exactly.
- Phase 5: grep -n "outsideWorkingHours" .rpiv/guidance/src/architecture.md shows the widened contract; the N017 note sits after the F021 paragraph.
- Terminal: git status --porcelain clean (state/ excluded); five commits in order; push once; PR carries the N016 checklist.
- lint-staged autofix: run npx biome check --write <slice paths> before each git add; review hook output per commit.
- Known risks (parent doc): staging discipline (explicit path lists only, verify git status between slices); TS2307 push window (mitigated by push-once); guidance/code contradiction window (slice 2 → slice 5, branch-internal, accepted).

## Performance Considerations

No runtime performance change: the fixes are export-keyword removals, a guard widening (skip cost: one execute() round-trip per parked surface — unchanged), and a test-idiom port. The judge.ts/watch.yml comment updates document that the fetch-stage timing term is pending first live measurement (the declared retune commit pastes it).

## Migration Notes

Not applicable — no persisted schema change; state/seen-posts.json format untouched. Rollback strategy: each commit is independently revertable whole-file; the guard commit is revert-safe (rule restore is additive).

## Pattern References

- Injection-seam default params (why the unexports are safe): src/fetch-linkedin-api.ts:152, src/fetch-threads.ts:206, src/fetch-threads.ts:297.
- Call-through spy idiom (N014 target): tests/session.test.ts:65-69, tests/fetch-threads.test.ts:302-327, tests/fetch-threads.test.ts:409-426.
- Accepted-cost paragraph template (N017 note shape): .rpiv/guidance/.github/workflows/architecture.md:75 (F021).
- Unexport precedent: .rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md:56-63 (N004).

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 2 §2 (tests/fetch-linkedin-api.test.ts) | tests/fetch-linkedin-api.test.ts:330-339 | concern | code-quality | GROUP C is introduced as "ported + new tests, verbatim" yet its last entry elides the body — the "passes the term verbatim" it() shows only a placement comment, so a literal paste yields a vacuously green test and silently drops the pinned executeParams assertions (:334-338); no gate catches the loss | Replace the elided fence entry with the verbatim body from the working tree (:330-339), or annotate the entry "keep the existing test untouched — not part of the paste" | applied: verbatim body pasted into the Phase 2 tests fence |
| coverage | ## Verification Notes §5 | <n/a> | concern | verification-coverage | "Phase 4: actionlint-free — the yaml is valid" — no criteria bullet and no code mirror runs actionlint or any yaml-validity check; watch.yml syntax errors would not surface in PR CI (cron workflow) and would first fire at the next scheduled tick post-merge | Add a yaml-validity check under Phase 4's Automated Verification | applied: Phase 4 gains a MANUAL yaml-validity bullet (actionlint if available, else eyeball the three hand-edited blocks); Verification Notes §5 reworded to match — no new toolchain dependency |
| code     | Desired End State | <n/a> | suggestion | code-quality | The fence comment "# newest last on this branch:" mislabels the listing — git log --oneline prints newest FIRST, and the fence's order is already newest-first, so an implementer comparing output against the annotation reads a correct tree as broken | Change the annotation to "newest first" | applied: annotation relabeled "newest first" |
| code     | Phase 5 §5 + Key Discoveries | <n/a> | suggestion | actionability | Three mutually inconsistent untracked-artifact counts in one trail (Key Discoveries "13", the §5 parenthetical summing to 14, the audit row's "10 + handoffs dir") | Reconcile to one number or drop the counts entirely — the git add .rpiv/artifacts/ step plus the eyeball check is count-agnostic | applied: counts dropped for count-agnostic wording in both spots |
| code     | Key Discoveries + Decisions (N014) | tests/session.test.ts:65 | suggestion | codebase-fit | "the repo idiom is inline t.mock.method call-through at 16 sites" overcounts — grep shows exactly 11 t.mock.method(console, ...) sites (fetch-threads.test.ts:304/390/410/432/433, index.test.ts:547/583/617/684/686, session.test.ts:65) | Correct the count to 11; the cited exemplar lines are accurate | applied: corrected to 11 sites in both spots |
## Developer Context

- Directional confirm 1 (2026-11-03): "Follow conventional style" — commit messages propagate git log's feat:/fix:/docs: lowercase-imperative convention across the 5 new commits.
- Directional confirm 2 (2026-11-03): "Inline like existing suites" — N014 ports captureLines to the 16-site inline t.mock.method idiom; no shared helper, no MockMethod import.
- N013 message decision (2026-11-03): "Two-arm message" — outsideWorkingHours keeps the current line verbatim (existing parked test :279-293 untouched); other reasons print parked (pendingReason: <reason>). Explicit nullish checks, not == null (file style :181-183).
- Design summary confirmed: Proceed. Decomposition confirmed: Approve (5 slices).

## Plan History

- Phase 1: Credential guard (N010) — approved as generated
- Phase 2: SDK module slice (N012a, N013, N014) — approved as generated
- Phase 3: Rewiring slice (N012b) — revised: the no-import-site success criterion re-scoped from any-mention to import/require lines (src/index.ts:112 doc comment survives a plain grep); approved after re-verification
- Phase 4: Workflow and lockfile slice — revised: the lockfile grep re-scoped from the quoted pattern (matched 1 of 3 sites) to the bare-substring count >= 3; approved after re-verification
- Phase 5: Docs and guidance slice (N015, N017) — approved as generated; revisions: SKILL.md one-line fix added (developer decision after the verifier flagged its silent drop from the parent's slice-4 list), fragile untracked-count annotation dropped
- Step 8 review: 0 blockers, 2 concerns, 3 suggestions
- Step 9 triage: 5/5 applied — verbatim test body pasted into the Phase 2 fence; Phase 4 manual yaml-validity bullet + Verification Notes reword; newest-first label; artifact counts dropped; spy-idiom count corrected to 11

## References

- Parent solutions: .rpiv/artifacts/solutions/2026-11-03_08-01-55_tech-debt-run4-remediation-execution.md (Option 1 + corrections 1-2)
- Driving research: .rpiv/artifacts/research/2026-11-02_22-53-12_tech-debt-audit-remediation.md
- FRD: .rpiv/artifacts/discover/2026-11-02_22-40-38_tech-debt-audit-remediation.md
- Audit rows: .rpiv/artifacts/TECH_DEBT_AUDIT.md (N010-N017 at :25-32)
- Cutover plan: .rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md

## Follow-up (2026-11-03_11-45-49)

Post-execution corrections after the implement run (2026-11-03). No code changes — the branch landed green (4 commits, 241 tests); these edits reconcile the plan document with what actually ran.

1. **N010 guard commit did not exist to make.** The plan's Key Discoveries already recorded that HEAD (ecc9865) holds `linkedin-state*.b64` at :8; the working-tree deletion was never committed. Restoring the tree left zero diff, so the planned "fix: gitignore linkedin-state session blobs" commit is structurally empty and was skipped by developer decision. The guard's substance is satisfied and verified: rule present at :8, blob deleted, `git check-ignore linkedin-state.b64` exits 0. The branch carries FOUR commits (feat/refactor/feat/docs); the Desired End State fence and the Phase 5 log criterion now say so. The "five commits" prose elsewhere (Overview, Requirements, Ordering Constraints) is preserved as pre-run history — this section is the record of the as-run deviation.
2. **Phase 4 dependency snippet read a nonexistent key.** The `node -e` assertion used `p.lint`, but the lint script lives at `p.scripts.lint` — the original expression always threw (TypeError) and exited 1. The snippet is corrected in place; the corrected assertion exits 0 against the committed tree (verified during the run).

Remaining inconsistency, accepted: the PR body of #6 was written before the four-commit outcome was known and still says "Five commits" in no place — it was authored with four commit rows from the start; no action. Other plans/documents referencing a five-commit stack need their own revise pass.
