// Reading JSON back out of a small model's answer.
//
// They fence it, apologise around it, and often write more than one object per turn. None of that
// is worth a retry, but none of it may turn into an invented field either: anything unreadable
// stays prose, and prose proposes nothing.

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/** A plain object, or an empty one. Reading a field off a number should not throw. */
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Every balanced top-level object in the answer, in order. Slicing from the first brace to the last
 * one breaks as soon as a model writes two objects, and that is exactly when we used to give up and
 * print our own protocol at the user.
 */
export function jsonObjects(raw: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth > 0) continue;
      const parsed = parseObject(raw.slice(start, index + 1));
      if (parsed) found.push(parsed);
      start = -1;
    }
  }
  return found;
}

function parseObject(slice: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(slice);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Balanced braces that are not JSON: prose, a code sample, a half-written object. Keep scanning.
    return null;
  }
}
