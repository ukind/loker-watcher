/**
 * One LLM account from the LLM_ACCOUNTS pool (N092's leaf home): ordered;
 * index 0 is tried first. Zero imports — a true leaf, so every judge-side
 * importer points INTO it without a runtime or type cycle (the
 * judge-shared -> judge-health -> judge back-edge family this move
 * deletes; madge --circular reads zero cycles with it).
 */

/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}
