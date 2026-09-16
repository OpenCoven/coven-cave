import { randomUUID } from "node:crypto";
import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowSessionReference } from "../flow-session.ts";

export type FlowDiscussionSource = {
  familiarId: string;
  harness: string;
  title: string;
  reference: FlowSessionReference;
  transcript: string;
};

export type FlowDiscussionDeps = {
  loadSource(sessionId: string): Promise<FlowDiscussionSource | null>;
  saveConversation(conversation: ConversationFile): Promise<void>;
  registerConversation(conversation: ConversationFile): Promise<void>;
  mintSessionId?: () => string;
};

/** Only an explicit user action calls this. Viewing a run never writes a chat. */
export async function createFlowDiscussion(
  deps: FlowDiscussionDeps,
  sourceSessionId: string,
): Promise<ConversationFile | null> {
  const source = await deps.loadSource(sourceSessionId);
  if (!source) return null;
  const sessionId = (deps.mintSessionId ?? randomUUID)();
  const now = new Date().toISOString();
  const turnId = randomUUID();
  const output = source.transcript.trim();
  const excerpt = output.length > 16_000 ? output.slice(-16_000) : output;
  const context = [
    `Discussion of ${source.title}. The execution transcript remains separate.`,
    `Flow: ${source.reference.flowId}\nRun: ${source.reference.runId}\nExecution session: ${sourceSessionId}`,
    ...(source.reference.missionId ? [`Research mission: ${source.reference.missionId}`] : []),
    output
      ? `${output.length > excerpt.length ? "Execution output excerpt (last 16,000 characters)" : "Execution output"}:\n\n${excerpt}`
      : "No execution output is available yet. View the run for its latest status.",
  ].join("\n\n");
  // Do not copy runtime, native session ids, approvals, or access fingerprints.
  // The first human send goes through the ordinary Chat project launch gate.
  const conversation: ConversationFile = {
    sessionId,
    familiarId: source.familiarId,
    harness: source.harness,
    title: `Discuss: ${source.title}`,
    origin: "chat",
    parentSessionId: sourceSessionId,
    flowDiscussion: { ...source.reference, sessionId: sourceSessionId },
    createdAt: now,
    updatedAt: now,
    turns: [{ id: turnId, role: "assistant", text: context, createdAt: now }],
    activeLeafId: turnId,
  };
  await deps.saveConversation(conversation);
  await deps.registerConversation(conversation);
  return conversation;
}
