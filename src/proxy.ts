import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "coven_cave_access";
const TOKEN_QUERY_PARAM = "coven_access_token";

function configuredAccessToken() {
  const token = process.env.COVEN_CAVE_ACCESS_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

function timingSafeEqualString(a: string, b: string) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function bearerToken(req: NextRequest) {
  const header = req.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return null;
  return header.slice(prefix.length).trim();
}

function hasValidToken(req: NextRequest, expected: string) {
  const token =
    bearerToken(req) ??
    req.cookies.get(TOKEN_COOKIE)?.value ??
    req.nextUrl.searchParams.get(TOKEN_QUERY_PARAM);
  return token ? timingSafeEqualString(token, expected) : false;
}

export function proxy(req: NextRequest) {
  const expected = configuredAccessToken();
  if (!expected || hasValidToken(req, expected)) {
    const queryToken = req.nextUrl.searchParams.get(TOKEN_QUERY_PARAM);
    if (!expected || !queryToken) return NextResponse.next();

    const url = req.nextUrl.clone();
    url.searchParams.delete(TOKEN_QUERY_PARAM);
    const res = NextResponse.redirect(url);
    res.cookies.set(TOKEN_COOKIE, queryToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    });
    return res;
  }

  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
