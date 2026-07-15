import { NextResponse } from "next/server";
import { loadMessageFeedback, recordMessageFeedback } from "@/lib/server/message-feedback-store";
import { rollupMessageFeedback } from "@/lib/message-feedback-rollup";

export const dynamic = "force-dynamic";

/**
 * Records LOCAL per-message thumbs feedback (up / down / toggled-off) for later
 * quality analytics. The store whitelists fields and never egresses — see
 * message-feedback-store.ts. GET serves AGGREGATE counts only (per-model /
 * per-runtime up-down rollups for the familiar analytics surface) — raw local
 * traces (message ids, timestamps) are never served back to the client.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const entry = await recordMessageFeedback(body as Parameters<typeof recordMessageFeedback>[0]);
  if (!entry) {
    return NextResponse.json({ ok: false, error: "invalid feedback" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || undefined;
  const entries = await loadMessageFeedback();
  return NextResponse.json({
    ok: true,
    rollup: rollupMessageFeedback(entries, { familiarId }),
  });
}
