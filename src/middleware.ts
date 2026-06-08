import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(req: NextRequest) {
  const token = process.env.COVEN_CAVE_AUTH_TOKEN;
  if (!token) return NextResponse.next();

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
  matcher: "/api/:path*",
};
