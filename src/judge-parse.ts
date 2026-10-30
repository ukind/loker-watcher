/**
 * Verdict parsers for the LLM judge (F010): the single-post parseVerdict
 * and the bulk parseBulkVerdicts with its readVerdict item validator —
 * moved verbatim from judge.ts. Behavior is unchanged.
 *
 * Contract: parsers are total. They return null on unusable input and
 * never throw; a malformed bulk item is simply absent from the returned
 * Map, never a batch failure.
 */
import type { JudgeVerdict } from "./types.js";

/**
 * Extract and validate a JudgeVerdict from raw LLM response text.
 * Tolerates surrounding markdown code fences and whitespace.
 */
export function parseVerdict(content: string): JudgeVerdict | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.relevant === "boolean" &&
      typeof parsed.locationOk === "boolean"
    ) {
      return {
        relevant: parsed.relevant,
        locationOk: parsed.locationOk,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Validate one unknown bulk item as a JudgeVerdict; null when malformed. */
function readVerdict(item: unknown): JudgeVerdict | null {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (typeof record.relevant === "boolean" && typeof record.locationOk === "boolean") {
    return { relevant: record.relevant, locationOk: record.locationOk };
  }
  return null;
}

/**
 * Parse a bulk verdict response into an id-keyed Map.
 *
 * Returns null (container-level failure) ONLY when the whole response is
 * unrecoverable: no braces, invalid JSON, or a non-object container. A
 * malformed item is simply absent from the Map — never a batch failure.
 * Ids stay strings (Post.id exceeds Number.MAX_SAFE_INTEGER — never
 * Number()-coerced); a Map also neutralizes hostile keys such as
 * "__proto__". Never throws.
 */
export function parseBulkVerdicts(content: string): Map<string, JudgeVerdict> | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const verdicts = new Map<string, JudgeVerdict>();
    for (const [id, item] of Object.entries(parsed)) {
      const verdict = readVerdict(item);
      if (verdict !== null) {
        verdicts.set(id, verdict);
      }
    }
    return verdicts;
  } catch {
    return null;
  }
}
