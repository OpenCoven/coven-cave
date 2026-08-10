import type { ChatAttachment } from "./chat-attachments";
import type { ChatResponseMetadata } from "./chat-response-metadata";
import type { ModelControlValues } from "./model-control-capabilities";
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
import { createAttentionSafeTextAccumulator } from "@/lib/chat-attention-stream";

export async function streamFamiliarText(opts: {
  familiarId: string;
  prompt: string;
  /** Staged files riding with the prompt. The bridge owns composition (text
   *  inlined, images written to temp files the harness can Read) — pass them
   *  through pre-stripped (see stripPreviewOnlyAttachmentFieldsKeepingImages). */
  attachments?: ChatAttachment[];
  sessionId?: string;
  projectRoot?: string;
  /** Per-send token so callers can stop this ephemeral run via /api/chat/stop. */
  runId?: string;
  reasoningEffort?: string;
  responseSpeed?: string;
  /** Advisory permission mode forwarded to the chat bridge. Use "read" for
   *  hidden/meta generations so prompt-injected transcript text cannot trigger
   *  privileged tool execution. */
  permissionMode?: "read" | "full";
  /** Empty string is the explicit Runtime-default sentinel. */
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session" | "runtime-default";
  modelControls?: ModelControlValues;
  /** Session provenance — set by generator surfaces (e.g. "journal") so the
   *  chat lists can hide the run; user-facing chats leave it unset. */
  origin?: SessionOrigin;
  signal?: AbortSignal;
  /** Called with the accumulated assistant text after each streamed chunk,
   *  so callers can render the reply incrementally as it arrives. The
   *  human-attention directive (chat sidebar attention task) applies to every
   *  chat send, so this is the one place every direct caller — quick chat,
   *  prompt enhance, reply recommendation, the review-draft generator, and
   *  true-voice (familiar-brain) — gets `<coven:attention …>` stripped for
   *  free, complete or partial-tail-hidden mid-stream, without each consumer
   *  re-implementing the marker protocol. This is display stripping only:
   *  the server route (`/api/chat/send`) owns parsing and persisting the
   *  actual `attentionRequest` metadata; nothing here fabricates it. */
  onText?: (text: string) => void;
  /** Called the moment the bridge announces the backing session id — before
   *  the stream completes — so callers can keep the thread resumable even if
   *  the run is aborted mid-stream. */
  onSession?: (sessionId: string) => void;
  /** Completed-turn facts, kept separate from the streamed assistant text. */
  onResponseMetadata?: (metadata: ChatResponseMetadata) => void;
}): Promise<{
  text: string;
  error: string | null;
  sessionId?: string;
  responseMetadata?: ChatResponseMetadata;
}> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: opts.familiarId,
        prompt: opts.prompt,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        ...(opts.projectRoot ? { projectRoot: opts.projectRoot } : {}),
        ...(opts.runId ? { runId: opts.runId } : {}),
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        ...(opts.responseSpeed ? { responseSpeed: opts.responseSpeed } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        ...(opts.modelOverride !== undefined ? { modelOverride: opts.modelOverride } : {}),
        ...(opts.modelOverrideScope ? { modelOverrideScope: opts.modelOverrideScope } : {}),
        ...(opts.modelControls && Object.keys(opts.modelControls).length
          ? { modelControls: opts.modelControls }
          : {}),
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
  const attentionText = createAttentionSafeTextAccumulator();
  let error: string | null = null;
  let sessionId: string | undefined;
  let responseMetadata: ChatResponseMetadata | undefined;

  const noteSession = (id: string | undefined) => {
    if (!id) return;
    sessionId = id;
    opts.onSession?.(id);
  };
  const handleFrame = (frame: string) => {
    const ev = parseSseFrame(frame);
    if (!ev) return;
    if (ev.kind === "assistant_chunk") {
      const visible = attentionText.append(ev.text ?? "");
      opts.onText?.(visible);
    } else if (ev.kind === "assistant_replace") {
      const visible = attentionText.replace(ev.text ?? "");
      opts.onText?.(visible);
    } else if (ev.kind === "session") noteSession(ev.sessionId);
    else if (ev.kind === "done") {
      noteSession(ev.sessionId);
      if (ev.responseMetadata) {
        responseMetadata = ev.responseMetadata;
        opts.onResponseMetadata?.(ev.responseMetadata);
      }
      if (ev.cancelled) error = error ?? "cancelled";
      else if (ev.isError) error = error ?? "the familiar reported an error";
    } else if (ev.kind === "error") error = ev.message ?? "generation error";
  };

  try {
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
  } catch (err) {
    error = opts.signal?.aborted
      ? "cancelled"
      : error ?? (err as Error)?.message ?? "the connection dropped mid-generation";
  }
<<<<<<< HEAD
  // Flush the decoder (a multi-byte character can straddle the final chunk)
  // and process a last frame that arrived without its trailing blank line.
  buffer += decoder.decode();
  if (buffer.trim()) handleFrame(buffer);
  const finalText = error === "cancelled" ? attentionText.cancelled() : attentionText.settled();
  return {
    text: error === "cancelled" && finalText.trim() === "(cancelled)" ? "" : finalText,
=======
  return {
    text: error !== null ? attentionText.terminal() : attentionText.settled(),
>>>>>>> c2d45598b7ab124a176d1cb83b7ee37e5f9811cf
    error,
    sessionId,
    responseMetadata,
  };
}
