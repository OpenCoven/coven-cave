// Client helper: ask a familiar to generate a self-contained UI document by
// streaming /api/chat/send (the same chat bridge the Familiars surface uses —
// Cave has no server-side LLM, so generation routes through the daemon agent).
// The SSE frame parser is exported pure so it can be unit-tested.

import { extractArtifact, type ArtifactKind } from "@/lib/canvas-artifacts";

export type SketchStreamEvent = {
  kind?: string;
  text?: string;
  sessionId?: string;
  isError?: boolean;
  message?: string;
};

/**
 * Parse one SSE frame into its event object, or null.
 *
 * A frame is everything between blank-line separators and may carry `id:`,
 * `event:`, and comment lines ahead of its `data:` payload — /api/chat/send
 * frames every event as "id: N\ndata: {json}" so /api/chat/stream can resume
 * from the last seen id. A parser that required the frame to *start with*
 * "data:" dropped every id-carrying event, which read as "the familiar didn't
 * return a reflection" in the journal and a blind stream everywhere else
 * (cave-am2b). Multi-line data is joined with newlines per the SSE spec; CRLF
 * line endings are tolerated for platform WebViews that normalize them.
 */
export function parseSseFrame(frame: string): SketchStreamEvent | null {
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const payload = data.join("\n").trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as SketchStreamEvent;
  } catch {
    return null;
  }
}

export type GenerateResult = {
  code: string | null;
  kind: ArtifactKind | null;
  text: string;
  sessionId: string | null;
  error: string | null;
  /** Structured cause so Canvas can repair format failures without retrying
   * transport/auth/runtime failures or parsing user-facing copy. */
  failure: "transport" | "format" | null;
};

/**
 * Send `prompt` to `familiarId` and collect the assistant's full text, then
 * extract the HTML document from it. `onText` fires with the running text so
 * the UI can show progress. The prompt is sent verbatim — callers wrap it with
 * buildSketchPrompt / buildRefinePrompt before calling.
 */
export async function generateArtifactCode(opts: {
  prompt: string;
  familiarId: string;
  projectRoot?: string | null;
  /** Resume the hidden Canvas-origin conversation (used by one-shot repair). */
  sessionId?: string | null;
  signal?: AbortSignal;
  onText?: (fullText: string) => void;
}): Promise<GenerateResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: opts.familiarId,
        prompt: opts.prompt,
        sessionId: opts.sessionId ?? undefined,
        projectRoot: opts.projectRoot ?? undefined,
        // Provenance: these sends belong to the Canvas/artifact surface, so
        // the chat lists can keep them out of the conversation rail.
        origin: "canvas",
      }),
      signal: opts.signal,
    });
  } catch (err) {
    return {
      code: null,
      kind: null,
      text: "",
      sessionId: opts.sessionId ?? null,
      error: opts.signal?.aborted ? "cancelled" : (err as Error)?.message ?? "request failed",
      failure: "transport",
    };
  }
  if (!res.ok || !res.body) {
    return {
      code: null,
      kind: null,
      text: "",
      sessionId: opts.sessionId ?? null,
      error: `chat bridge ${res.status}`,
      failure: "transport",
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sessionId: string | null = opts.sessionId ?? null;
  let error: string | null = null;

  // A mid-stream network drop (or an abort) makes reader.read() REJECT — an
  // unguarded loop turned that into a rejected promise that wedged callers'
  // "generating" state forever (cave-v35w). Convert to a normal error result
  // and keep any partial text.
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSseFrame(frame);
        if (!ev) continue;
        switch (ev.kind) {
          case "assistant_chunk":
            text += ev.text ?? "";
            opts.onText?.(text);
            break;
          case "session":
            sessionId = ev.sessionId ?? sessionId;
            break;
          case "done":
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.isError) error = error ?? "the familiar reported an error";
            break;
          case "error":
            error = ev.message ?? "generation error";
            break;
        }
      }
    }
  } catch (err) {
    error = opts.signal?.aborted
      ? "cancelled"
      : (err as Error)?.message ?? "the connection dropped mid-generation";
  }

  const extracted = extractArtifact(text);
  const failure = error ? "transport" : extracted ? null : "format";
  return {
    code: extracted?.code ?? null,
    kind: extracted?.kind ?? null,
    text,
    sessionId,
    error: error ?? (failure === "format" ? "response format could not be previewed" : null),
    failure,
  };
}
