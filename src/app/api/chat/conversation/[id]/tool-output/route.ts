import { NextResponse } from "next/server";
import { isSafeConversationSessionId, loadConversationCached } from "@/lib/cave-conversations";
import { findToolOutput } from "@/lib/conversation-tool-output";
import { loadConversationFromJsonl } from "@/lib/openclaw-conversation";
import { loadState } from "@/lib/cave-config";

export const dynamic = "force-dynamic";

// The full output of one tool, for a card opened in a transcript loaded with
// `?toolOutputs=recent` (#5581). Same session-id guard and sources as the
// conversation GET beside it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  const toolId = new URL(req.url).searchParams.get("toolId")?.trim() ?? "";
  if (!toolId || toolId.length > 256) {
    return NextResponse.json({ ok: false, error: "toolId required" }, { status: 400 });
  }
  let conversation: unknown = await loadConversationCached(id);
  if (!conversation) {
    const familiarId = (await loadState()).sessionFamiliar[id];
    if (familiarId) conversation = await loadConversationFromJsonl(id, familiarId);
  }
  const lookup = findToolOutput(conversation as Parameters<typeof findToolOutput>[0], toolId);
  if (lookup.kind === "found") return NextResponse.json({ ok: true, output: lookup.output });
  if (lookup.kind === "ambiguous") {
    return NextResponse.json({ ok: false, error: "tool id is not unique in this conversation" }, { status: 409 });
  }
  return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
}
