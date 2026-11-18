// Edge-safe (no node imports): used by middleware and server code.
export const SESSION_COOKIE = "ob_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export function isLocalHost(host: string | null | undefined): boolean {
  const h = (host ?? "").split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

// Secure everywhere except plain localhost (dev and local `next start`).
export function cookieOptions(host: string | null | undefined) {
  return {
    httpOnly: true,
    secure: !isLocalHost(host),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
