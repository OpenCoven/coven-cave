import { NextResponse } from "next/server.js";

import { isLocalOrigin } from "./local-origin.ts";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse };

function hostName(value: string | null): string {
  if (!value) return "";
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0];
}

function isLocalHost(value: string | null): boolean {
  return LOCAL_HOSTS.has(hostName(value));
}

export function rejectNonLocalRequest(req: Request): NextResponse | null {
  // Delegate the mobile-proxy marker, packaged sidecar-token, and loopback-Host
  // checks to the shared isLocalOrigin gate so the desktop-only security policy
  // lives in exactly one place (see local-origin.ts). We then layer this
  // route family's stricter Origin-header parsing on top.
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    if (!isLocalHost(parsed.host)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  return null;
}

export async function readJsonBody<T>(req: Request, maxBytes: number): Promise<JsonBodyResult<T>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "application/json required" }, { status: 415 }),
    };
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "request body too large" }, { status: 413 }),
    };
  }

  const reader = req.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }),
    };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "request body too large" }, { status: 413 }),
      };
    }
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(Buffer.concat(chunks));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }),
    };
  }

  // Guarded routes read `parsed.body.field`; a non-object root (JSON null,
  // primitive, or array) would throw a TypeError → Next 500. Reject it here so
  // callers get a clean 400 instead.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }),
    };
  }

  return { ok: true, body: parsed as T };
}
