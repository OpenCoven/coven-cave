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

/** Parse one SSE frame ("data: {...}") into its event object, or null. */
export function parseSseFrame(frame: string): SketchStreamEvent | null {
  if (!frame.startsWith("data:")) return null;
  const payload = frame.slice(5).trim();
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
        projectRoot: opts.projectRoot ?? undefined,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    return { code: null, kind: null, text: "", sessionId: null, error: (err as Error)?.message ?? "request failed" };
  }
  if (!res.ok || !res.body) {
    return { code: null, kind: null, text: "", sessionId: null, error: `chat bridge ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sessionId: string | null = null;
  let error: string | null = null;

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

  const extracted = extractArtifact(text);
  if (!extracted && !error) {
    error = "The familiar didn't return a renderable UI. Try rephrasing.";
  }
  return {
    code: extracted?.code ?? null,
    kind: extracted?.kind ?? null,
    text,
    sessionId,
    error,
  };
}
