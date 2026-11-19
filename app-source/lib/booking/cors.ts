// Exact-origin allowlist for future satellite brand surfaces calling this
// engine cross-origin. The scheduler's own pages need no CORS at all — this
// only matters the day a second Next.js app on another domain calls
// /api/booking/slots or /api/booking/book directly.

function allowedOrigins(): string[] {
  const raw = process.env.BOOKING_CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds CORS headers for a request. Echoes back the request's Origin only
 * on an exact allowlist match (never a wildcard), and always sets
 * `Vary: Origin` so a shared cache can never leak one origin's response to
 * another.
 */
export function corsHeaders(requestOrigin: string | null): HeadersInit {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!requestOrigin) return headers;

  const allowed = allowedOrigins();
  if (allowed.includes(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

export function isPreflight(method: string): boolean {
  return method === "OPTIONS";
}
