// Voice new-chat: pre-create an EMPTY conversation file so a voice call can
// attach to a brand-new session from turn zero. This exists because
// appendTurn (cave-conversations.ts) silently drops transcript turns when the
// conversation file is missing — a call minted against a bare session id
// would lose its transcript. Deps are injected so tests stay hermetic
// (same pattern as daemon-update-lifecycle.ts).

import type { ConversationFile } from "../cave-conversations.ts";

export type VoiceChatCreateDeps = {
  /** null when the familiar does not exist. */
  loadFamiliarBinding(familiarId: string): Promise<{ harness: string } | null>;
  saveConversation(conv: ConversationFile): Promise<void>;
  recordSessionFamiliar(sessionId: string, familiarId: string): Promise<void>;
  setSessionTitle(sessionId: string, title: string): Promise<void>;
  defaultTitle(sessionId: string): string;
  /** Override for tests; defaults to crypto.randomUUID. */
  mintSessionId?: () => string;
};

export type VoiceChatCreateResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: "familiar_not_found" | "save_failed" };

export async function createVoiceChatSession(
  deps: VoiceChatCreateDeps,
  input: { familiarId: string; projectRoot: string | null },
): Promise<VoiceChatCreateResult> {
  const binding = await deps.loadFamiliarBinding(input.familiarId);
  if (!binding) return { ok: false, error: "familiar_not_found" };

  const sessionId = (deps.mintSessionId ?? (() => crypto.randomUUID()))();
  const now = new Date().toISOString();
  const conv: ConversationFile = {
    sessionId,
    familiarId: input.familiarId,
    harness: binding.harness,
    // Provenance: this session was born for a voice call, not a typed chat.
    origin: "call",
    // chat/send reads the conversation cwd from `runtime: "local:<cwd>"`.
    ...(input.projectRoot ? { runtime: `local:${input.projectRoot}` } : {}),
    createdAt: now,
    updatedAt: now,
    turns: [],
  };

  try {
    await deps.saveConversation(conv);
    await deps.recordSessionFamiliar(sessionId, input.familiarId);
    await deps.setSessionTitle(sessionId, deps.defaultTitle(sessionId));
  } catch {
    return { ok: false, error: "save_failed" };
  }
  return { ok: true, sessionId };
}
