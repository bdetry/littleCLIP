/**
 * Extracts the last valid top-level JSON object from a raw stdout string.
 *
 * Strategy:
 *  1. Fast path — scan lines from the end; agents typically emit a single-line
 *     JSON.stringify() as their final output.
 *  2. Fallback — brace-depth scan (no string tracking) to find candidate
 *     regions, validating each with JSON.parse. Keeps the last success.
 *
 * String-state tracking is intentionally omitted because non-JSON noise
 * (e.g. system prompts containing escaped quotes like `\"key\"`) corrupts
 * the state machine. Letting JSON.parse validate candidates is both simpler
 * and more robust.
 */
export function extractLastJson(raw: string): Record<string, unknown> | null {
  // --- Fast path: line-by-line from the end ---
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      // not valid single-line JSON, keep scanning
    }
  }

  // --- Fallback: brace-depth scan for multi-line JSON ---
  let last: Record<string, unknown> | null = null;
  let depth = 0;
  let currentStart = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "{") {
      if (depth === 0) currentStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && currentStart !== -1) {
        const candidate = raw.slice(currentStart, i + 1);
        try {
          const obj = JSON.parse(candidate);
          if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
            last = obj as Record<string, unknown>;
          }
        } catch {
          // invalid candidate, continue
        }
        currentStart = -1;
      }
      if (depth < 0) depth = 0;
    }
  }

  return last;
}
