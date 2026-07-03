import { NextResponse, type NextRequest } from "next/server";
import { refreshMobileAccessToken } from "@/lib/mobile-token-refresh";
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_QUERY_PARAM } from "@/proxy-helpers";

export const dynamic = "force-dynamic";

/** The credential the caller actually presented — same sources, same order,
 *  as the proxy's mobileAccessGate (Bearer header, cookie, query param). */
function suppliedCredential(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  const prefix = "Bearer ";
  if (header?.startsWith(prefix)) {
    const token = header.slice(prefix.length).trim();
    if (token) return token;
  }
  const cookie = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (cookie) return cookie;
  return req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM);
}

/**
 * Rolling renewal for paired mobile devices: exchange a currently-valid
 * credential for a fresh 30-day signed token. Unauthenticated callers never
 * reach this route while the gate is enabled (the proxy 401s first); the
 * re-verification inside refreshMobileAccessToken binds the minted token to
 * the presented credential and makes the route safe even in tokenless modes,
 * where it reports the gate as disabled instead of minting anything.
 */
export async function POST(req: NextRequest) {
  const result = await refreshMobileAccessToken({
    supplied: suppliedCredential(req),
    secret: process.env.COVEN_CAVE_ACCESS_TOKEN?.trim() || null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    token: result.token,
    expiresAt: result.expiresAt,
    expiresAtIso: new Date(result.expiresAt).toISOString(),
  });
}
