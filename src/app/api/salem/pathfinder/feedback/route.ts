import { NextResponse } from "next/server";
import { recordFeedback } from "@/lib/salem/pathfinder-feedback";

export const dynamic = "force-dynamic";

/**
 * Records LOCAL Salem pathfinder feedback (which path, helpful?, saved?, an
 * optional correction). The store whitelists fields and never egresses — see
 * pathfinder-feedback.ts. POST-only; no read endpoint (local traces are not
 * served back to the client in v0).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const entry = await recordFeedback(body as Parameters<typeof recordFeedback>[0]);
  if (!entry) {
    return NextResponse.json({ ok: false, error: "invalid feedback" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
