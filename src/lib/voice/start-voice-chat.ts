// Voice new-chat client helpers (spec:
// docs/superpowers/specs/2026-07-18-voice-new-chat-design.md).
//
// startVoiceConversation pre-creates the empty conversation a voice call
// attaches to; discardVoiceSessionIfEmpty cleans up when the call ends with
// nothing said, so cancelled calls don't litter the thread rail. Deleting is
// safe: chat/send recreates the file on demand for the same session id.

export type StartVoiceChatResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

export async function startVoiceConversation(
  familiarId: string,
  projectRoot: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<StartVoiceChatResult> {
  try {
    const res = await fetchImpl("/api/chat/conversation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId, ...(projectRoot ? { projectRoot } : {}) }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; sessionId?: string; error?: string }
      | null;
    if (!json?.ok || typeof json.sessionId !== "string") {
      return { ok: false, error: json?.error ?? `create_failed_http_${res.status}` };
    }
    return { ok: true, sessionId: json.sessionId };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Delete the session's conversation when it holds zero turns. Returns true
 *  when a delete was issued. Never throws. */
export async function discardVoiceSessionIfEmpty(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(sessionId);
    const res = await fetchImpl(`/api/chat/conversation/${encoded}`);
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; conversation?: { turns?: unknown[] } | null }
      | null;
    if (!json?.ok || !json.conversation) return false;
    if ((json.conversation.turns ?? []).length > 0) return false;
    await fetchImpl(`/api/chat/conversation/${encoded}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}
