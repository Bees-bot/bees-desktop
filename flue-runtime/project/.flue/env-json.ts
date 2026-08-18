/**
 * Bees writes these variables itself when it launches the runtime, so a value that will not parse is
 * a bug on our side, not user input. This throws rather than returning an empty record; what that
 * costs is the caller's call, because a missing route ends the run and a missing window does not.
 */
export function envObject(name: string, raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${name} is not valid JSON: ${raw}`, { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object: ${raw}`);
  }
  return parsed as Record<string, unknown>;
}
