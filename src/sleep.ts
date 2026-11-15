/**
 * The injectable wait seam (N060): production is the module sleep; tests pass
 * an inert recorder. Its own module because the seam is cross-domain —
 * fetch-threads.ts and src/index.ts import it alongside the judge group, and
 * a Threads module reaching into a judge-named module is the dependency the
 * layering forbids. Moved verbatim out of judge-dispatch.ts (which re-imports
 * it: judgePost defaults sleepFn to it).
 */

/** Sleep that a test can skip by injecting a fake timer. Exported as the
 * production default for the WatcherDeps.sleepFn seam (src/index.ts). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Injectable wait seam: production is the module sleep; tests pass an inert
 * recorder. Exported (F010/D5) for judge-rotation.ts's parkUntilEligible. */
export type SleepFn = (ms: number) => Promise<void>;
