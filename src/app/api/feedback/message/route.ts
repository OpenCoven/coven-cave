import { NextResponse } from "next/server";
import { recordMessageFeedback } from "@/lib/server/message-feedback-store";

export const dynamic = "force-dynamic";

/**
 * Records LOCAL per-message thumbs feedback (up / down / toggled-off) for later
 * quality analytics. The store whitelists fields and never egresses — see
 * message-feedback-store.ts. POST-only; no read endpoint (local traces are not
 * served back to the client).
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
