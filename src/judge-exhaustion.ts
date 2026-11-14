import {
  type RotationState,
  earliestCooldown,
  hasOutstandingRelease,
  parkUntilEligible,
  waitCeilingSlot,
} from "./judge-rotation.js";
/**
 * The blocked-pick policy (N060): what a dispatcher does when the pool scan
 * finds no eligible account — the D4 flavor split and the D11 dead-pool
 * guard, extracted verbatim out of judge-dispatch.ts's dispatchLlmCall so
 * the god-file shrinks below the 500-line bar. It composes ONLY rotation
 * primitives (which keep their ZERO-RUNTIME-IMPORT identity) plus the
 * availability predicate from judge-shared.ts, so the one-way runtime edges
 * run exhaustion -> rotation and exhaustion -> judge-shared; nothing imports
 * this module except the dispatch core.
 */
import { allAvailabilityBlocked } from "./judge-shared.js";
import type { SleepFn } from "./sleep.js";

/**
 * One blocked pick: wait out a recoverable block (a release wake at ZERO
 * budget charge, or a budget-bounded cooldown park) or report the pool dead.
 * Returns true when the caller should re-pick WITHOUT spending an attempt
 * (the wait is not a retry), false when the pool is dead — the caller maps
 * false to its { status: "exhausted" } terminal OUTSIDE its release-guarded
 * try (D6: a throw here would be swallowed and misread as a transport error).
 */
export async function resolveBlockedPick(
  state: RotationState,
  now: () => number,
  sleepFn: SleepFn,
): Promise<boolean> {
  // Every account is cooling, at its ceiling, or mask-refused — split
  // the flavors (D4). FIRST: a release outstanding — some account
  // still has calls in flight, and every claim's finally (and every
  // fresh cooldown stamp) wakes the release queue — so wait at ZERO
  // budget charge. A peer seconds from freeing a slot must never
  // route the dispatcher onto the paid cooldown timer: cooldown-first
  // parks rewound dispatchers, three parks spend the whole 180s cell,
  // and the rest convert to exhaustion while healthy seats hold
  // capacity (watch episode 2026-11-07..09: eleven consecutive runs
  // exited 1 with the exhaustion record naming account 1 alone). A
  // quiet pool (no release can ever wake the queue) keeps the old
  // flavors in order: an active cooldown parks through the shared
  // budget (the only road to the exhaustion terminal, OUTSIDE the try
  // in dispatchLlmCall — a throw here would be swallowed by the catch
  // and misread as a transport error); a permanently-dead pool — every
  // seat mask-refused, or capped with its probe spent and drained, and
  // no cooldown pending — trips the terminal immediately at zero budget
  // charge (the D11 guard). The trailing arm is unreachable by the
  // case analysis (an at-ceiling seat carries in-flight, a cooling
  // seat parks above); it stays a terminal — never a timerless wait
  // that could hang.
  if (hasOutstandingRelease(state)) {
    await waitCeilingSlot(state);
  } else if (earliestCooldown(state, now()) !== undefined) {
    if (!(await parkUntilEligible(state, now, sleepFn))) {
      return false;
    }
  } else if (allAvailabilityBlocked(state)) {
    return false;
  } else {
    return false;
  }
  return true;
}
