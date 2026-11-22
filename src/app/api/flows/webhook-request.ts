import { NextResponse } from "next/server";

const MAX_WEBHOOK_BYTES = 2_000_000;

export type WebhookContext = { params: Promise<{ path?: string[] }> };

export async function readWebhookBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true, body: undefined };
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_WEBHOOK_BYTES) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 }) };
  }
  if (bytes.byteLength === 0) return { ok: true, body: undefined };
  const text = new TextDecoder().decode(bytes);
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      return { ok: true, body: JSON.parse(text) };
    } catch {
      return { ok: false, response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }) };
    }
  }
  return { ok: true, body: text };
}

export function queryObject(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  return query;
}
