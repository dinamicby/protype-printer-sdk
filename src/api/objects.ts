/**
 * The printer's own account of what it has: the configured section names and
 * the parsed config behind them.
 *
 * Kept apart from the client so the shaping can be tested without a socket —
 * the same split as `webcams.ts`.
 */

/** `/printer/objects/list` → `result.objects`, names exactly as configured. */
export function parseObjectsList(raw: unknown): string[] {
  const objects = (raw as any)?.objects;
  if (!Array.isArray(objects)) return [];
  return objects.filter((o: unknown): o is string => typeof o === 'string');
}

/** `/printer/objects/query?configfile=settings` → `status.configfile.settings`. */
export function parseConfigSettings(raw: unknown): Record<string, unknown> {
  const settings = (raw as any)?.status?.configfile?.settings;
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}
