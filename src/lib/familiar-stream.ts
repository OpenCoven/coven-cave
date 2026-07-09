import type { SessionOrigin } from "./types";
// Client helper: stream a one-shot prompt to a familiar through the chat bridge
// (`/api/chat/send`, SSE) and return the concatenated assistant text. This is the
// sanctioned client-side LLM path — the same bridge evals, workflow-generate, and
// canvas-generate use. There is no server-side LLM route (the daemon exposes only
// sessions + events), so anything that needs a familiar to "think" runs here.
//
// Pass `sessionId` to resume an existing thread's context (the harness continues
// that conversation). Omit it for a fresh, ephemeral run that never touches the
// user's saved conversations — useful for meta tasks like thread reflection.

import { parseSseFrame } from "@/lib/canvas-generate";

export async function streamFamiliarText(opts: {
  familiarId: string;
  prompt: string;
  sessionId?: string;
  reasoningEffort?: string;
  responseSpeed?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
  /** Session provenance — set by generator surfaces (e.g. "journal") so the
   *  chat lists can hide the run; user-facing chats leave it unset. */
  origin?: SessionOrigin;
  signal?: AbortSignal;
  /** Called with the accumulated assistant text after each streamed chunk,
   *  so callers can render the reply incrementally as it arrives. */
  onText?: (text: string) => void;
  /** Called the moment the bridge announces the backing session id — before
   *  the stream completes — so callers can keep the thread resumable even if
   *  the run is aborted mid-stream. */
  onSession?: (sessionId: string) => void;
}): Promise<{ text: string; error: string | null; sessionId?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: opts.familiarId,
        prompt: opts.prompt,
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        ...(opts.responseSpeed ? { responseSpeed: opts.responseSpeed } : {}),
        ...(opts.modelOverride ? { modelOverride: opts.modelOverride } : {}),
        ...(opts.modelOverrideScope ? { modelOverrideScope: opts.modelOverrideScope } : {}),
        // Provenance for generated runs (journal narratives, …) so the chat
        // lists can keep them out of the conversation rail (#2719 model).
        ...(opts.origin ? { origin: opts.origin } : {}),
      }),
      signal: opts.signal,
    });
  } catch (err) {
    return { text: "", error: (err as Error)?.message ?? "request failed" };
  }
  if (!res.ok || !res.body) return { text: "", error: `chat bridge ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let error: string | null = null;
  let sessionId: string | undefined;

  const noteSession = (id: string | undefined) => {
    if (!id) return;
    sessionId = id;
    opts.onSession?.(id);
  };
  const handleFrame = (frame: string) => {
    const ev = parseSseFrame(frame);
    if (!ev) return;
    if (ev.kind === "assistant_chunk") {
      text += ev.text ?? "";
      opts.onText?.(text);
    } else if (ev.kind === "session") noteSession(ev.sessionId);
    else if (ev.kind === "done") {
      noteSession(ev.sessionId);
      if (ev.isError) error = error ?? "the familiar reported an error";
    } else if (ev.kind === "error") error = ev.message ?? "generation error";
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  // Flush the decoder (a multi-byte character can straddle the final chunk)
  // and process a last frame that arrived without its trailing blank line.
  buffer += decoder.decode();
  if (buffer.trim()) handleFrame(buffer);
  return { text, error, sessionId };
}
