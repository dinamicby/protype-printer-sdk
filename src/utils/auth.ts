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

/** Resolves the current Moonraker API key, or null/undefined when none is set. */
export type ApiKeyProvider = () => string | null | undefined;

/**
 * Build the `X-Api-Key` header for a Moonraker with `[authorization]` enabled.
 *
 * Orthogonal to {@link bearerHeader}, not an alternative to it: the bearer
 * authorizes against the ProControl proxy, this key against Moonraker itself,
 * and a request can legitimately need both. Returns an empty object when there
 * is no key so callers can spread it unconditionally — an empty string means
 * "no key", not "a key that is empty".
 */
export function apiKeyHeader(
  key: string | null | undefined,
): Record<string, string> {
  return key ? {'X-Api-Key': key} : {};
}
