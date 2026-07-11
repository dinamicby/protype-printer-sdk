/**
 * Auth helpers for talking to the ProControl proxy (port 7200) that fronts
 * Moonraker. Remote clients must send `Authorization: Bearer <JWT>` on every
 * request — including the WebSocket upgrade. These helpers keep that header
 * construction in one place so the REST client and the WS client agree.
 */

/** Resolves the current bearer token, or null/undefined when unauthenticated. */
export type AuthTokenProvider = () => string | null | undefined;

/**
 * Build the Authorization header for a bearer token. Returns an empty object
 * when there is no token so callers can spread it unconditionally without
 * emitting a malformed `Authorization: Bearer ` header.
 */
export function bearerHeader(
  token: string | null | undefined,
): Record<string, string> {
  return token ? {Authorization: `Bearer ${token}`} : {};
}
