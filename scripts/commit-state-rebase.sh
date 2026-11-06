#!/bin/bash
#
# Commit-back body for watch.yml's "Commit state" step (F021) and the
# probe job's "Commit ceilings" step: rebase onto main, skip conflicts in
# the committed state files (bounded), lease-push, retry once.
#
# The Actions queue serializes watcher runs, but a human push can land
# between this run's checkout and its commit-back, so the push rebases onto
# main first. The rebase rewrites SHAs whenever main moved mid-run, making
# the push non-fast-forward by construction; --force-with-lease still
# rejects a concurrent push the local fetch has not seen. A state commit
# that conflicts against main's own lines for a committed state file
# (state/seen-posts.json, state/judge-ceilings.json) is skipped whole (the
# next run re-judges, or the next probe run overwrites; one duplicate
# digest or one stale-ceiling stretch is the accepted cost) instead of
# failing the run. ANY other conflicted path is real work failing to
# replay: abort loudly and exit 1.
#
# Invoked EXACTLY ONCE by watch.yml — the single retry lives here. The step
# shell consumes the exit contract with no wrapper: exit 0 = pushed; exit 1
# = non-state conflict abort or second push failure.
#
# This script sets errexit itself: the step shell's implicit 'bash -e' does
# not cross the process boundary. It must run from the workspace root (it
# never cd's — the relative .git/rebase-merge test only resolves there).
#
# Deviation ledger (FR2 byte-for-byte review aid): the ONLY deliberate
# deviation from the moved YAML body is the skip-bound exhaustion echo
# inside attempt() below (FRD FR2 + TECH_DEBT_AUDIT.md:74). Second
# deviation (2026-11-06, ceilings commit-back): the skip test grew from a
# single-literal equality to set membership over the two committed state
# files. Everything else is a verbatim move of watch.yml's former :123-167.
#
# The 50-skip bound is a runaway guard, not a tuning knob: a replayed
# commit conflicts at most once per state line, so 50 skips means the
# rebase is wedged; the bound is hard-coded per repo doctrine (no env
# tunables) and the exhaustion echo below makes hitting it legible.

set -e

# One commit-back attempt: rebase onto main (skipping state-only conflicts
# up to the bound), then lease-push; exit 0 the moment a push succeeds.
# The skip budget resets on every call — each attempt starts fresh (the
# former YAML body reset skips=0 the same way before each loop).
attempt() {
  if ! git pull --rebase origin main; then
    echo "state rebase conflicted; skipping conflicting state commits"
    skips=0
    while test -d .git/rebase-merge && [ "$skips" -lt 50 ]; do
      # Skip ONLY committed-state-file conflicts; any other conflicted
      # path is real work failing to replay (F021's loud failure
      # preserved). git lists conflicted paths one per line, so this is
      # set membership over that list — a heredoc (not a pipe) keeps the
      # loop in this shell, where the all_state flag survives.
      conflicts=$(git diff --name-only --diff-filter=U)
      all_state=1
      while IFS= read -r path; do
        case "$path" in
          "" | state/seen-posts.json | state/judge-ceilings.json) ;;
          *) all_state=0 ;;
        esac
      done <<EOF
$conflicts
EOF
      if [ "$all_state" -eq 0 ]; then
        echo "non-state conflict in: $conflicts — failing the run"
        git rebase --abort
        exit 1
      fi
      # --skip exits nonzero when it stops at the NEXT conflict; the
      # loop condition must see that, so this is set -e-proof.
      git rebase --skip || true
      skips=$((skips + 1))
    done
    # Deviation (the ledger's single entry): the bound exhausted with a
    # conflict still on the table — say so, then fall through to the same
    # push the unbounded former body would have attempted.
    if test -d .git/rebase-merge; then
      echo "state skip bound (50) exhausted; conflicts remain — attempting push anyway"
    fi
  fi
  if git push --force-with-lease; then
    exit 0
  fi
}

attempt
echo "state push rejected; rebasing onto main and retrying once"
attempt
echo "state push failed twice; failing the run"
exit 1
