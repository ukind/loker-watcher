/**
 * The two browser-hardening constants both context factories need (N059).
 *
 * The factories themselves stay duplicated on purpose: the shared
 * ContextFactory seam carries a storage-state PATH and a headless launch,
 * and widening it breaks all three existing doubles under
 * strictFunctionTypes (src/linkedin-context.ts's header documents the
 * decision). The UA string and the webdriver patch are the two copies that
 * MUST move together — a Chrome bump that updates one and not the other
 * leaves the two legs presenting different fingerprints.
 *
 * knip-safe: both constants have two cross-module importers
 * (src/fetch-threads.ts and src/linkedin-context.ts), so neither is the
 * N012 dead-export class.
 */

/** The pinned UA (Chrome 131 on Windows) both factories present. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The webdriver patch, kept as a string so the Node build needs no DOM lib
 * (locked tsconfig: lib ES2023, types node).
 */
export const WEBDRIVER_PATCH =
  "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });";
