import { NextResponse } from "next/server";
import { loadConversation } from "@/lib/cave-conversations";
import { linkedContextForSession } from "@/lib/chat-linked-context";
import { loadConversationFromJsonl } from "@/lib/openclaw-conversation";
import { loadState } from "@/lib/cave-config";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await linkedContextForSession(id);

  // Primary: cave-conversations JSON (written by chat/send for UI-originated chats)
  const conv = await loadConversation(id);
  if (conv) {
    return NextResponse.json({ ok: true, conversation: conv, context });
  }

  // Fallback: read the openclaw .jsonl transcript for sessions that were started
  // outside CovenCave (via CLI, OpenClaw channel, or another harness).
  // We need the familiarId to know which agent folder to look in.
  const state = await loadState();
  const familiarId = state.sessionFamiliar[id];
  if (familiarId) {
    const jsonlConv = await loadConversationFromJsonl(id, familiarId);
    if (jsonlConv) {
      return NextResponse.json({ ok: true, conversation: jsonlConv, context });
    }
  }

  return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
}
