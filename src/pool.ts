/**
 * Shared bounded worker pool (F007).
 *
 * One implementation of the slot-array pool idiom that judge.ts and
 * fetch-threads.ts each hand-copied four times: a shared cursor claims work
 * in input order, at most `width` items run in flight, and the caller
 * reassembles results from its own slot arrays after the join.
 *
 * Contract (matches every migrated site's behavior exactly):
 * - Claims advance in one synchronous window (read `next`, increment,
 *   bounds-check — no await between), so N workers stay coherent without
 *   locks and work is claimed in input order. Callers that stop early
 *   (budgets, exhaustion flags) starve the TAIL, never a random middle.
 * - The worker is TOTAL: it never rejects. Failures ride caller-owned side
 *   channels (result slots, failure lists, outcome unions, exhausted
 *   flags). A rejecting worker propagates through Promise.all exactly like
 *   the hand copies did — drain-then-throw stays the caller's job.
 * - Results reassemble by SLOT INDEX, not by runPool's return: workers
 *   write caller-owned pre-sized arrays (including carried indices such as
 *   `slots[item.slot]`), so input order comes from the join-then-walk.
 *
 * Zero imports: a leaf module both the acquisition and the funnel layers
 * may use without inverting the guidance's downward-only import rule.
 */

/**
 * Drain `items` through at most `width` workers, calling `worker(item,
 * index)` once per item. Width is clamped to the work count (Math.min), so
 * a short list never spawns idle workers and an empty list is a no-op.
 * Resolves when every claimed item has been processed — join-never-rejects
 * for total workers.
 */
export async function runPool<T>(
  items: readonly T[],
  width: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      // Claim in one sync window: read + advance + bounds-check with no
      // await between — the same window the hand-copied cursors used.
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, run));
}
