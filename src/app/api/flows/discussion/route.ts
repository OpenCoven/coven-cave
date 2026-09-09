import { NextResponse } from "next/server";
import { bindingFor, initializeSessionTitleOwnership, loadConfig, recordSessionFamiliar } from "@/lib/cave-config";
import { isSafeConversationSessionId, loadConversation, saveConversation } from "@/lib/cave-conversations";
import { flowSessionReferenceFor } from "@/lib/flow-session";
import { localConversationSessionRows } from "@/lib/session-list-merge";
import { createFlowDiscussion } from "@/lib/server/flow-discussion";
import { flowSessionTranscript } from "@/lib/server/flow-session-transcript";
import { listFlowRuns, loadFlowSessionState } from "@/lib/server/flow-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const sessionId = body && typeof body === "object" && "sessionId" in body ? body.sessionId : null;
  if (typeof sessionId !== "string" || !isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  const state = await loadFlowSessionState(false);
  const reference = flowSessionReferenceFor(state.sessionFlow, sessionId);
  if (!reference) {
    return NextResponse.json({ ok: false, error: "Flow execution ownership not found" }, { status: 404 });
  }
  const source = await loadConversation(sessionId);
  const familiarId = source?.familiarId ?? state.sessionFamiliar[sessionId];
  const config = await loadConfig();
  if (!familiarId || !Object.hasOwn(config.familiars, familiarId)) {
    return NextResponse.json({ ok: false, error: "Execution familiar not found" }, { status: 404 });
  }
  const run = (await listFlowRuns(reference.flowId)).find((candidate) => candidate.id === reference.runId);
  const conversation = await createFlowDiscussion({
    loadSource: async () => ({
      familiarId,
      harness: bindingFor(config, familiarId).harness,
      title: run?.flowName ?? source?.title ?? reference.flowId,
      reference,
      transcript: await flowSessionTranscript(sessionId),
    }),
    saveConversation,
    registerConversation: async (created) => {
      await recordSessionFamiliar(created.sessionId, created.familiarId);
      await initializeSessionTitleOwnership(created.sessionId, created.title!);
    },
  }, sessionId);
  if (!conversation) throw new Error("Flow discussion source disappeared");
  const [session] = localConversationSessionRows([conversation], state, false);
  return NextResponse.json({
    ok: true, sessionId: conversation.sessionId, familiarId, session,
  });
}
