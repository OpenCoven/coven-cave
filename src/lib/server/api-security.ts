import { NextResponse } from "next/server.js";

import { LOCAL_REQUEST_REQUIRED_CODE } from "../project-errors.ts";
import { isLocalOrigin } from "./local-origin.ts";
import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";
import { isValidResearchMediaTicketRequest } from "../research-media-ticket.ts";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function localRequestRequired(): NextResponse {
  // Keep the legacy forbidden error for callers that only understand the old
  // response, while the code gives clients a stable repair path.
  return NextResponse.json(
    { ok: false, code: LOCAL_REQUEST_REQUIRED_CODE, error: "forbidden" },
    { status: 403 },
  );
}

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
    return localRequestRequired();
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return localRequestRequired();
    }
    if (!isLocalHost(parsed.host)) {
      return localRequestRequired();
    }
  }

  return null;
}

/**
 * Research media is the one local route that must accept a native media
 * subrequest. A Tauri HTMLMediaElement cannot attach the sidecar header, so a
 * valid generation-scoped media ticket is an alternative credential. Keep the
 * exception here rather than weakening the shared local-origin rule used by
 * desktop-only APIs.
 */
export async function rejectResearchMediaRequest(req: Request): Promise<NextResponse | null> {
  const ordinary = rejectNonLocalRequest(req);
  if (!ordinary) return null;

  if (req.headers.get(MOBILE_ACCESS_HEADER) === "1") return ordinary;
  const host = req.headers.get("host");
  if (!isLocalHost(host)) return ordinary;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (!isLocalHost(new URL(origin).host)) return ordinary;
    } catch {
      return ordinary;
    }
  }
  const secret = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
  return await isValidResearchMediaTicketRequest(req, secret) ? null : ordinary;
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
