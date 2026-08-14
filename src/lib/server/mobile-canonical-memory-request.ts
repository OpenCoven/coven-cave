import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";

function hasProxyIssuedMobileMarker(req: Request): boolean {
  return req.headers.get(MOBILE_ACCESS_HEADER) === "1";
}

/**
 * `proxy.ts` removes every client-supplied `x-coven-cave-mobile-access` value
 * and re-adds `1` only after validating the Cave mobile credential. Route
 * handlers call this guard downstream of that trust boundary; the invariant is
 * pinned by `src/app/api/project-permission-routes.test.ts`.
 */
export function rejectUnverifiedMobileCanonicalMemoryRequest(
  req: Request,
): Response | null {
  if (hasProxyIssuedMobileMarker(req)) return null;
  return Response.json(
    { ok: false, code: "mobile_access_required" },
    { status: 401, headers: { "Cache-Control": "private, no-store" } },
  );
}
