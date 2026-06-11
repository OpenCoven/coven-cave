import { NextResponse } from "next/server";
import { searchConversations } from "@/lib/cave-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CHAT-D9-02: content search over stored conversation transcripts.
 *  GET /api/chat/search?q=… → { ok, hits: [{ sessionId, snippet, matchCount }] }
 *  Queries under 2 chars return an empty hit list rather than an error so the
 *  client can fire-and-render without special-casing. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, hits: [] });
  }
  const hits = await searchConversations(q);
  return NextResponse.json({ ok: true, hits });
}
