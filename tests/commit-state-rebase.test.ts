import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Black-box: the commit-state-rebase script runs as a real bash process
// against real git scratch repos under OS temp — the repo's first non-Node
// spawn, following the hooks suites' spawnSync convention
// (tests/format-on-edit.test.ts). The suite is the script's ONLY automated
// coverage (biome never sees .sh).
//
// Bash resolution runs ONCE at module scope (solutions-locked strategy):
// PATH bash wins only when `uname -s` answers MINGW/MSYS on win32 — the
// WSL launcher answers Linux and is the impostor to reject. Fallback:
// derive the Git-for-Windows bash from `git --exec-path` (…/mingw64/libexec
// /git-core → two levels up lands in mingw64, where bin/bash.exe lives).
// Neither: every test registers an explicit skip naming the problem
// (node:test options-skip; `npm test` still exits 0). Windows probe
// retired 2026-11-01 on the dev box: strategy 1 passed (MINGW64 answered;
// the exec-path fallback path was confirmed viable).
const SCRIPT = fileURLToPath(new URL("../scripts/commit-state-rebase.sh", import.meta.url));

/**
 * The child env: process.env minus every GIT_* variable — an ambient
 * GIT_DIR would hijack git inside the script AND inside this suite's own
 * fixtures, and a stray GIT_EXEC_PATH would redirect the probe's
 * `git --exec-path` — with LC_ALL pinned to C so git messages stay
 * byte-stable across machines.
 */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    if (value !== undefined) env[key] = value;
  }
  env.LC_ALL = "C";
  return env;
}

/** Resolve the bash binary, or null when no trustworthy one exists. */
function probeBash(): string | null {
  const direct = spawnSync("bash", ["-c", "uname -s"], {
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (direct.status === 0 && typeof direct.stdout === "string") {
    if (process.platform !== "win32" || /MINGW|MSYS/.test(direct.stdout.trim())) {
      return "bash";
    }
  }
  if (process.platform === "win32") {
    const execPath = spawnSync("git", ["--exec-path"], {
      env: cleanEnv(),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (execPath.status === 0 && typeof execPath.stdout === "string") {
      // .../mingw64/libexec/git-core: two levels up lands in mingw64,
      // where bin/bash.exe lives.
      const root = join(execPath.stdout.trim(), "..", "..");
      return join(root, "bin", "bash.exe");
    }
  }
  return null;
}

const BASH = probeBash();
const BASH_PROBLEM =
  BASH === null
    ? "bash unavailable or hostile on this machine (MINGW/MSYS gate and git --exec-path fallback both failed)"
    : null;

/**
 * Run git in `cwd`, returning stdout; throws naming the command on
 * failure — fixture setup must fail loudly, never pass vacuously.
 */
function git(cwd: string, args: string[]): string {
  const run = spawnSync("git", args, {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${String(run.status)}): ${run.stderr}`);
  }
  return run.stdout;
}

const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-01T06:00:00.000Z";

function stateJson(ids: Record<string, string>): string {
  return `${JSON.stringify({ version: 2, seenPostIds: ids }, null, 2)}\n`;
}

/**
 * One scratch scenario: a bare origin plus a work repo with identity
 * config, a v2-schema state seed (src/state.ts AppState), and upstream
 * set exactly as actions/checkout would leave it.
 */
interface Scratch {
  root: string;
  origin: string;
  work: string;
}

async function makeScratch(name: string): Promise<Scratch> {
  const root = await mkdtemp(join(tmpdir(), `lw-commit-state-rebase-${name}-`));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, ["init", "--bare", "-b", "main", "origin.git"]);
  git(root, ["init", "-b", "main", "work"]);
  const config: ReadonlyArray<readonly [string, string]> = [
    ["user.name", "loker-watcher test"],
    ["user.email", "test@loker-watcher.invalid"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
  ];
  for (const [key, value] of config) {
    git(work, ["config", key, value]);
  }
  // Plain local path, not file:// — the script's own `git pull` must
  // reach origin the same way the fixture's git does.
  git(work, ["remote", "add", "origin", origin]);
  await mkdir(join(work, "state"), { recursive: true });
  await writeFile(join(work, "state", "seen-posts.json"), stateJson({ a: T0 }), "utf8");
  git(work, ["add", "state/seen-posts.json"]);
  git(work, ["commit", "-m", "initial state"]);
  git(work, ["push", "-u", "origin", "main"]);
  git(work, ["fetch", "origin"]);
  // The refspec-less `git push --force-with-lease` inside the script
  // needs upstream; production gets it from actions/checkout.
  git(work, ["branch", "--set-upstream-to", "origin/main", "main"]);
  return { root, origin, work };
}

/**
 * Simulate the human push that lands between the run's checkout and its
 * commit-back: a second clone commits to origin's main directly.
 */
async function advanceOrigin(
  root: string,
  origin: string,
  edits: {
    stateIds?: Record<string, string>;
    notes?: string;
    ceilings?: string;
    health?: string;
  },
): Promise<void> {
  const other = join(root, "other");
  git(root, ["clone", "--quiet", origin, "other"]);
  git(other, ["config", "user.name", "human pusher"]);
  git(other, ["config", "user.email", "human@loker-watcher.invalid"]);
  if (edits.stateIds !== undefined) {
    await writeFile(join(other, "state", "seen-posts.json"), stateJson(edits.stateIds), "utf8");
    git(other, ["add", "state/seen-posts.json"]);
  }
  if (edits.ceilings !== undefined) {
    await writeFile(join(other, "state", "judge-ceilings.json"), edits.ceilings, "utf8");
    git(other, ["add", "state/judge-ceilings.json"]);
  }
  if (edits.health !== undefined) {
    await writeFile(join(other, "state", "judge-health.json"), edits.health, "utf8");
    git(other, ["add", "state/judge-health.json"]);
  }
  if (edits.notes !== undefined) {
    await writeFile(join(other, "notes.md"), edits.notes, "utf8");
    git(other, ["add", "notes.md"]);
  }
  git(other, ["commit", "-m", "human push lands mid-run"]);
  git(other, ["push", "origin", "main"]);
}

/** Run the script under test in the work repo, as the workflow step would. */
function runScript(cwd: string): SpawnSyncReturns<string> {
  const bash = BASH;
  if (bash === null) throw new Error(BASH_PROBLEM ?? "bash unavailable");
  // The script path stays a Windows-style absolute argv (MSYS only remaps
  // /...-looking args). stdout and stderr stay SEPARATE: the script
  // signals through its exit code and its echoes route to stdout (the
  // former YAML body's echo did too).
  return spawnSync(bash, [SCRIPT], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}

/** Read the state blob on origin's main (bare repo: `git show` from inside). */
function originState(origin: string): string {
  return git(origin, ["show", "main:state/seen-posts.json"]);
}

const PRE_RECEIVE = `#!/bin/sh
# Test fixture: counts every push attempt into a sibling file; the first
# push is rejected while a sibling marker exists (consumed on use).
dir=$(dirname "$0")
count_file="$dir/push-count"
if [ -f "$count_file" ]; then
  n=$(cat "$count_file")
else
  n=0
fi
n=$((n + 1))
echo "$n" > "$count_file"
if [ -f "$dir/reject-first" ]; then
  rm "$dir/reject-first"
  echo "pre-receive: first-push rejection fixture"
  exit 1
fi
exit 0
`;

describe("commit-state-rebase script", () => {
  it(
    "pushes a clean state commit: exit 0, origin advanced",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("clean");
      try {
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        // The YAML-owned head this suite mimics: add + commit only.
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, b: T1 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "skips a state-only conflict to origin's version: exit 0, our id absent",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("state-skip");
      try {
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);
        // The human push: a DIFFERENT state id lands on origin first.
        await advanceOrigin(root, origin, { stateIds: { a: T0, c: T1 } });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted F021 cost, pinned: origin keeps ITS version — our
        // id b is gone and the next run re-judges those posts.
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, c: T1 },
        });
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a non-state conflict: exit 1, rebase state cleaned, origin untouched",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("non-state");
      try {
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "notes.md", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "notes + state: 1 new seen post ids"]);
        // The human push: a notes.md of its own lands on origin first.
        await advanceOrigin(root, origin, { notes: "origin side\n" });
        const before = git(work, ["rev-parse", "HEAD"]).trim();
        const run = runScript(work);
        assert.equal(run.status, 1, `status ${String(run.status)}: ${run.stderr}`);
        // The abort message routes to STDOUT (echo), as in the YAML body.
        assert.match(run.stdout, /non-state conflict in: notes\.md/);
        // The abort actually unwound: no rebase in flight, HEAD unmoved.
        await assert.rejects(() => access(join(work, ".git", "rebase-merge")), /ENOENT/);
        assert.equal(git(work, ["rev-parse", "HEAD"]).trim(), before);
        // Origin untouched: its notes survive; our state id never landed.
        assert.match(git(origin, ["show", "main:notes.md"]), /origin side/);
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "retries exactly once when the first push is rejected: exit 0, push count 2",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("retry");
      try {
        // Bare-origin pre-receive fixture: counts pushes, rejects the first.
        const hooksDir = join(origin, "hooks");
        await writeFile(join(hooksDir, "pre-receive"), PRE_RECEIVE, "utf8");
        await chmod(join(hooksDir, "pre-receive"), 0o755);
        await writeFile(join(hooksDir, "reject-first"), "consume me\n", "utf8");

        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);

        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // "Exactly one retry" pinned as the integer 2.
        assert.equal((await readFile(join(hooksDir, "push-count"), "utf8")).trim(), "2");
        // The one-shot rejection was consumed on push #1.
        await assert.rejects(() => access(join(hooksDir, "reject-first")), /ENOENT/);
        // The retry echo proves attempt #2 ran the full body again.
        assert.match(
          run.stdout,
          /state push rejected; rebasing onto the branch remote and retrying once/,
        );
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, b: T1 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "skips a judge-ceilings conflict (the probe job's commit-back): exit 0, origin keeps its ceilings",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("ceilings-skip");
      try {
        // The probe-job head this suite mimics: add + commit the ceilings
        // file only.
        await writeFile(
          join(work, "state", "judge-ceilings.json"),
          '{"https://account-one.api/v1": 4}\n',
          "utf8",
        );
        git(work, ["add", "state/judge-ceilings.json"]);
        git(work, ["commit", "-m", "judge: probe-measured ceilings"]);
        // The human push: a DIFFERENT ceilings reading lands on origin
        // first (add/add conflict — the file did not exist at the merge
        // base).
        await advanceOrigin(root, origin, { ceilings: '{"https://account-one.api/v1": 2}\n' });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted skip cost, pinned for the second state file: origin
        // keeps ITS reading; the next green probe run overwrites.
        assert.match(git(origin, ["show", "main:state/judge-ceilings.json"]), /: 2\}/);
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a two-line conflict when one path is outside the state set: exit 1",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("mixed-conflict");
      try {
        // Our commit touches one state file AND one non-state file.
        await writeFile(
          join(work, "state", "judge-ceilings.json"),
          '{"https://account-one.api/v1": 4}\n',
          "utf8",
        );
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        git(work, ["add", "state/judge-ceilings.json", "notes.md"]);
        git(work, ["commit", "-m", "ceilings + notes"]);
        // Origin moved BOTH paths: the conflict list has two lines, one
        // in the skip set, one outside — the outside line fails the
        // attempt whole; nothing is skipped piecemeal.
        await advanceOrigin(root, origin, {
          ceilings: '{"https://account-one.api/v1": 2}\n',
          notes: "origin side\n",
        });
        const before = git(work, ["rev-parse", "HEAD"]).trim();
        const run = runScript(work);
        assert.equal(run.status, 1, `status ${String(run.status)}: ${run.stderr}`);
        assert.match(run.stdout, /non-state conflict in: notes\.md/);
        // The abort actually unwound: no rebase in flight, HEAD unmoved.
        await assert.rejects(() => access(join(work, ".git", "rebase-merge")), /ENOENT/);
        assert.equal(git(work, ["rev-parse", "HEAD"]).trim(), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "skips a judge-health conflict (the watch job's failure-path commit-back): exit 0, origin keeps its marks",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("health-skip");
      try {
        // The Commit health head this suite mimics: add + commit the
        // health file only.
        await writeFile(
          join(work, "state", "judge-health.json"),
          '{"version": 1, "marks": {"https://account-one.api/v1": 2}, "outageOpen": true}\n',
          "utf8",
        );
        git(work, ["add", "state/judge-health.json"]);
        git(work, ["commit", "-m", "judge: provider health marks"]);
        // The human push: a DIFFERENT marks reading lands on origin first
        // (add/add conflict — the file did not exist at the merge base).
        await advanceOrigin(root, origin, {
          health:
            '{"version": 1, "marks": {"https://account-one.api/v1": 1}, "outageOpen": false}\n',
        });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted skip cost, pinned for the third state file: origin
        // keeps ITS reading; the next run overwrites.
        assert.match(git(origin, ["show", "main:state/judge-health.json"]), /: 1\}/);
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "recovers a dispatch-run commit-back when the sibling job advanced the branch: exit 0, both commits land",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("dispatch-branch-race");
      try {
        // The dispatch shape (run 885, 2026-11-07): the watch job checks
        // out github.sha — the branch head at DISPATCH time — so the
        // sibling probe job's later push is invisible to it. Work happens
        // on a feature branch, not main.
        git(work, ["checkout", "-b", "judge-provider-health"]);
        git(work, ["push", "-u", "origin", "judge-provider-health"]);
        // The watch job's local commit (seen-posts + the health file).
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        await writeFile(
          join(work, "state", "judge-health.json"),
          '{"version": 1, "marks": {}, "outageOpen": false}\n',
          "utf8",
        );
        git(work, ["add", "state/seen-posts.json", "state/judge-health.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);
        // The probe job's ceilings commit lands on the branch AFTER the
        // watch checkout pinned its SHA — the exact run-885 race.
        const probe = join(root, "probe");
        git(root, ["clone", "--quiet", "-b", "judge-provider-health", origin, "probe"]);
        git(probe, ["config", "user.name", "probe job"]);
        git(probe, ["config", "user.email", "probe@loker-watcher.invalid"]);
        await writeFile(
          join(probe, "state", "judge-ceilings.json"),
          '{"https://account-one.api/v1": 4}\n',
          "utf8",
        );
        git(probe, ["add", "state/judge-ceilings.json"]);
        git(probe, ["commit", "-m", "judge: probe-measured ceilings"]);
        git(probe, ["push", "origin", "judge-provider-health"]);

        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The old failure mode pinned dead: BOTH commits on the branch —
        // the probe's ceilings untouched (disjoint files, no skip needed),
        // the state commit replayed on top of it.
        assert.match(
          git(origin, ["show", "judge-provider-health:state/judge-ceilings.json"]),
          /: 4\}/,
        );
        assert.deepEqual(
          JSON.parse(git(origin, ["show", "judge-provider-health:state/seen-posts.json"])),
          { version: 2, seenPostIds: { a: T0, b: T1 } },
        );
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a two-line conflict when one path is outside the state set (health + notes): exit 1",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("health-mixed");
      try {
        // Our commit touches the health file AND one non-state file.
        await writeFile(
          join(work, "state", "judge-health.json"),
          '{"version": 1, "marks": {}, "outageOpen": false}\n',
          "utf8",
        );
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        git(work, ["add", "state/judge-health.json", "notes.md"]);
        git(work, ["commit", "-m", "health + notes"]);
        // Origin moved BOTH paths: the conflict list has two lines, one
        // in the skip set, one outside — the outside line fails the
        // attempt whole; nothing is skipped piecemeal.
        await advanceOrigin(root, origin, {
          health:
            '{"version": 1, "marks": {"https://account-one.api/v1": 3}, "outageOpen": true}\n',
          notes: "origin side\n",
        });
        const before = git(work, ["rev-parse", "HEAD"]).trim();
        const run = runScript(work);
        assert.equal(run.status, 1, `status ${String(run.status)}: ${run.stderr}`);
        assert.match(run.stdout, /non-state conflict in: notes\.md/);
        // The abort actually unwound: no rebase in flight, HEAD unmoved.
        await assert.rejects(() => access(join(work, ".git", "rebase-merge")), /ENOENT/);
        assert.equal(git(work, ["rev-parse", "HEAD"]).trim(), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
