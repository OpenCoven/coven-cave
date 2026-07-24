// Generate a personal journal reflection by streaming /api/chat/send — the same
// daemon-agent bridge canvas generation uses (Cave has no server-side LLM). The
// prompt builder is pure and unit-tested; the transport mirrors canvas-generate
// but returns the assistant's plain text (no artifact extraction).

import { parseSseFrame } from "@/lib/canvas-generate";
import { extractNextPaths } from "@/lib/next-paths";
import { DEFAULT_JOURNAL_PROMPT, renderJournalPrompt } from "@/lib/journal-prompt";

/** Wrap the day's activity context into a request for a short first-person
 *  reflection. `template` (the editable Generation prompt) defaults to the
 *  canonical one; `familiar`/`date` fill its placeholders. */
export function buildReflectionPrompt(
  context: string,
  opts?: { template?: string | null; familiar?: string; date?: string },
): string {
  return renderJournalPrompt(opts?.template || DEFAULT_JOURNAL_PROMPT, {
    familiar: opts?.familiar || "my familiar",
    date: opts?.date || "today",
    context,
  });
}

export type ReflectionResult = { text: string; error: string | null };

/**
 * Send the reflection prompt to `familiarId` and collect the assistant's full
 * text. `onText` fires with the running text so the UI can show progress.
 */
export async function generateReflection(opts: {
  familiarId: string;
  context: string;
  /** Custom Generation-prompt template (null/undefined = the default). */
  promptTemplate?: string | null;
  /** Display name for the template's `{familiar}` placeholder. */
  familiarName?: string;
  /** Human-readable day for the template's `{date}` placeholder. */
  dateLabel?: string;
  signal?: AbortSignal;
  onText?: (fullText: string) => void;
}): Promise<ReflectionResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // origin:"journal" keeps these generated runs out of the chat lists
      // (cave-buih, same provenance model as canvas-generate).
      body: JSON.stringify({
        familiarId: opts.familiarId,
        prompt: buildReflectionPrompt(opts.context, {
          template: opts.promptTemplate,
          ...(opts.familiarName ? { familiar: opts.familiarName } : {}),
          ...(opts.dateLabel ? { date: opts.dateLabel } : {}),
        }),
        origin: "journal",
      }),
      signal: opts.signal,
    });
  } catch (err) {
    return { text: "", error: (err as Error)?.message ?? "request failed" };
  }
  if (!res.ok || !res.body) {
    return { text: "", error: `chat bridge ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
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
        case "done":
          if (ev.isError) error = error ?? "the familiar reported an error";
          break;
        case "error":
          error = ev.message ?? "generation error";
          break;
      }
    }
  }

  // /api/chat/send appends the <coven:next-paths> suggestions directive to
  // every prompt, and a compliant familiar echoes the block back. The journal
  // has no chip row — strip it (terminated or truncated) so it never lands in
  // the stored reflection.
  const trimmed = extractNextPaths(text).visible.trim();
  if (!trimmed && !error) error = "The familiar didn't return a reflection. Try again.";
  return { text: trimmed, error };
}
