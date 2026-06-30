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
  signal?: AbortSignal;
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
      if (ev.kind === "assistant_chunk") text += ev.text ?? "";
      else if (ev.kind === "session") sessionId = ev.sessionId;
      else if (ev.kind === "done") {
        if (ev.sessionId) sessionId = ev.sessionId;
        if (ev.isError) error = error ?? "the familiar reported an error";
      }
      else if (ev.kind === "error") error = ev.message ?? "generation error";
    }
  }
  return { text, error, sessionId };
}
