import { NextResponse, type NextRequest } from "next/server";

const ACCESS_TOKEN_COOKIE = "coven_cave_access";
const ACCESS_TOKEN_QUERY_PARAM = "coven_access_token";
const TOKEN_PARAM = "covenCaveToken";
const TOKEN_HEADER = "x-coven-cave-token";
const SAFE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function configuredMobileAccessToken() {
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

function mobileAccessSuppliedTokens(req: NextRequest) {
  return [
    bearerToken(req),
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM),
  ].filter((token): token is string => Boolean(token));
}

function hasValidMobileAccessToken(req: NextRequest, expected: string) {
  return mobileAccessSuppliedTokens(req).some((token) => timingSafeEqualString(token, expected));
}

function mobileAccessGate(req: NextRequest) {
  const expected = configuredMobileAccessToken();
  if (!expected) return null;

  const queryToken = req.nextUrl.searchParams.get(ACCESS_TOKEN_QUERY_PARAM);
  if (!hasValidMobileAccessToken(req, expected)) {
    return jsonError(401, "unauthorized");
  }

  if (
    queryToken &&
    timingSafeEqualString(queryToken, expected) &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    const url = req.nextUrl.clone();
    url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM);
    const res = NextResponse.redirect(url);
    res.cookies.set(ACCESS_TOKEN_COOKIE, queryToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    });
    return res;
  }

  return null;
}

function isLoopbackHost(host: string | null) {
  if (!host) return false;
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function sameOrigin(value: string | null, expectedOrigin: string) {
  if (!value) return true;
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function bearerFromReferer(value: string | null, expectedOrigin: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== expectedOrigin) return null;
    return url.searchParams.get(TOKEN_PARAM);
  } catch {
    return null;
  }
}

function hasSafeContentType(req: NextRequest) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  const contentType = req.headers.get("content-type");
  if (!contentType) return true;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return SAFE_CONTENT_TYPES.includes(mediaType);
}

export function proxy(req: NextRequest) {
  const mobileRes = mobileAccessGate(req);
  if (mobileRes) return mobileRes;

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const token = process.env.COVEN_CAVE_AUTH_TOKEN;
  if (!token) {
    return process.env.COVEN_CAVE_BUNDLE === "1"
      ? jsonError(500, "missing sidecar auth token")
      : NextResponse.next();
  }

  const expectedOrigin = req.nextUrl.origin;
  if (!isLoopbackHost(req.headers.get("host"))) {
    return jsonError(403, "forbidden host");
  }
  if (!sameOrigin(req.headers.get("origin"), expectedOrigin)) {
    return jsonError(403, "forbidden origin");
  }
  if (!sameOrigin(req.headers.get("referer"), expectedOrigin)) {
    return jsonError(403, "forbidden referer");
  }
  if (!hasSafeContentType(req)) {
    return jsonError(415, "unsupported content-type");
  }

  const supplied =
    req.headers.get(TOKEN_HEADER) ??
    req.nextUrl.searchParams.get(TOKEN_PARAM) ??
    bearerFromReferer(req.headers.get("referer"), expectedOrigin);

  if (supplied !== token) {
    return jsonError(401, "unauthorized");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
