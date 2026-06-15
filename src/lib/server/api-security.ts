import { NextResponse } from "next/server";

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
  const host = req.headers.get("host");
  if (!isLocalHost(host)) {
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
  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }),
    };
  }
}
