import { NextResponse } from "next/server";

import {
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
  withConversationLock,
} from "@/lib/cave-conversations";
import { deleteTurn } from "@/lib/conversation-tree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/chat/conversation/[id]/turns/[turnId] — remove one message from
 * a chat, durably.
 *
 * Deleting a message used to be a client-side array splice: iOS dropped it
 * from its in-memory thread and rewrote its own local snapshot file, so the
 * message came back on reinstall and never disappeared anywhere else. This is
 * the server half.
 *
 * It is a per-turn route rather than another shape of the existing PUT, which
 * replaces the whole turn array. A client that deletes by re-PUTing its list
 * writes back everything it happens to be holding — so a reply that streamed
 * in while the user was deciding is silently erased by the delete. Naming the
 * single turn means concurrent writers cannot lose each other's turns, which
 * is exactly the property "reflect across clients" needs.
 *
 * No local-origin guard, deliberately: `/chat/conversation/[id]` has none
 * either, because the iOS app reaches these routes across the tailnet. Adding
 * one here would make the mobile delete fail where the mobile read succeeds.
 */

/** Bounds only — turn ids are opaque to this route and never touch a path. */
function isPlausibleTurnId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; turnId: string }> },
) {
  // No decodeURIComponent: Next already percent-decodes dynamic route params,
  // which is what the sibling `[id]` route relies on for the session id.
  // Decoding a second time is wrong twice over — a turn id holding a literal
  // `%41` would be mangled into `A` and match nothing, and an id holding a
  // bare `%` (sent correctly as `%25`) arrives decoded as `%`, where
  // decodeURIComponent throws URIError: an unhandled 500 with no JSON
  // envelope, from a perfectly well-formed request.
  const { id, turnId } = await params;
  if (!isSafeConversationSessionId(id)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  if (typeof turnId !== "string" || !isPlausibleTurnId(turnId)) {
    return NextResponse.json({ ok: false, error: "invalid turn id" }, { status: 400 });
  }

  return withConversationLock(id, async () => {
    const conversation = await loadConversation(id);
    // A missing conversation is a real 404 rather than a silent success: the
    // client is asking about a chat this server does not have, which is a
    // different situation from a turn that is already gone.
    if (!conversation) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const result = deleteTurn(conversation.turns, turnId, conversation.activeLeafId);
    if (!result.deleted) {
      // Idempotent: a retried delete whose first response never arrived must
      // not report failure. See deleteTurn for why this is worth the
      // ambiguity with a genuinely unknown id.
      return NextResponse.json({
        ok: true,
        deleted: false,
        activeLeafId: conversation.activeLeafId ?? null,
      });
    }

    conversation.turns = result.turns;
    if (result.activeLeafId === undefined) delete conversation.activeLeafId;
    else conversation.activeLeafId = result.activeLeafId;
    // The first-turn stub marker names a specific pending turn; leaving it
    // pointing at a deleted one makes the sessions list report a phantom
    // failed run forever.
    if (conversation.pendingUserTurnId === turnId) delete conversation.pendingUserTurnId;
    conversation.updatedAt = new Date().toISOString();

    await saveConversation(conversation);
    // Only the repaired leaf, not the transcript. Every handler on
    // `/chat/conversation/[id]` that returns a conversation runs it through
    // that route's private sanitizeConversationMetadata first (it normalizes
    // modelIntent and drops responseMetadata off user turns); echoing the raw
    // file here would hand clients a shape GET never produces, and ship the
    // whole transcript back over the tailnet on every single-message delete.
    // A client that wants the new state re-reads it with GET.
    return NextResponse.json({
      ok: true,
      deleted: true,
      activeLeafId: conversation.activeLeafId ?? null,
    });
  });
}
