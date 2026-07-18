// Voice new-chat client helpers (spec:
// docs/superpowers/specs/2026-07-18-voice-new-chat-design.md).
//
// startVoiceConversation pre-creates the empty conversation a voice call
// attaches to; discardVoiceSessionIfEmpty cleans up when the call ends with
// nothing said, so cancelled calls don't litter the thread rail. Deleting is
// safe: chat/send recreates the file on demand for the same session id.
//
// discardVoiceSessionIfEmpty never sacrifices the session id (server-side
// ?ifEmpty=1, route.ts). A client-side "GET turns, then DELETE" round trip
// left a window where an in-flight first exchange could recreate the file
// between the two calls — the DELETE used to sacrifice unconditionally, so
// the recreated file (holding the user's real conversation) was permanently
// hidden from every list. The single ifEmpty request makes the emptiness
// check and the delete atomic from the caller's point of view, and the
// route never sacrifices on this path, so a recreated file simply resurfaces
// in the rail instead of vanishing.

export type StartVoiceChatResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

/** Translate voice-chat mint error codes into user-facing copy shared by
 * both composer entry points, preserving unknown codes for diagnostics. */
export function voiceChatStartErrorMessage(code: string): string {
  if (code === "network") return "Couldn't start a voice chat — is the daemon running?";
  if (code === "familiar_not_found") return "Couldn't start a voice chat: that familiar no longer exists.";
  return `Couldn't start a voice chat (${code}).`;
}

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

/** Delete the session's conversation when it holds zero turns. The
 *  emptiness check happens server-side (?ifEmpty=1) in the same request as
 *  the delete, so there's no client-side GET→DELETE gap for an in-flight
 *  first exchange to land in. That server path also never sacrifices the
 *  session id — only a genuinely empty conversation is removed, and nothing
 *  is left behind to permanently hide a session that gets recreated a
 *  moment later. Returns true when a delete was issued. Never throws. */
export async function discardVoiceSessionIfEmpty(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(sessionId);
    const res = await fetchImpl(`/api/chat/conversation/${encoded}?ifEmpty=1`, { method: "DELETE" });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; deleted?: boolean } | null;
    return json?.ok === true && json.deleted === true;
  } catch {
    return false;
  }
}
