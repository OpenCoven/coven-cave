import { getRunBufferStatus } from "../../../../../lib/server/chat-stream-buffer.ts";
import { resolveConversationSessionId } from "../../../../../lib/cave-conversations.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId")?.trim() || null;
  const requestedSessionId = url.searchParams.get("sessionId")?.trim() || null;
  const resolvedSession = !runId && requestedSessionId
    ? await resolveConversationSessionId(requestedSessionId)
    : null;
  if (!runId && resolvedSession?.sessionId === null) {
    return Response.json(
      {
        ok: false,
        error: resolvedSession.error === "ambiguous-replay-history"
          ? "replay history is ambiguous for this session id"
          : "replay history contains a cycle for this session id",
      },
      { status: 409 },
    );
  }
  const key = runId || resolvedSession?.sessionId || requestedSessionId;
  if (!key) {
    return Response.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }

  return Response.json({
    ok: true,
    status: getRunBufferStatus(key),
  });
}
