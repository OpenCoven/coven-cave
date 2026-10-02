// Generate a personal journal reflection by streaming /api/chat/send — the same
// daemon-agent bridge canvas generation uses (Cave has no server-side LLM). The
// prompt builder is pure and unit-tested; the transport mirrors canvas-generate
// but returns the assistant's plain text (no artifact extraction).

import { parseSseFrame } from "@/lib/canvas-generate";
import { createAttentionSafeTextAccumulator } from "@/lib/chat-attention-stream";
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
    res = await fetch("/api/chat/generate/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The "journal" provenance is minted server-side by the generation route
      // (cave-cst0g): these generated runs stay out of the chat lists
      // (cave-buih, same provenance model as canvas-generate).
      body: JSON.stringify({
        familiarId: opts.familiarId,
        prompt: buildReflectionPrompt(opts.context, {
          template: opts.promptTemplate,
          ...(opts.familiarName ? { familiar: opts.familiarName } : {}),
          ...(opts.dateLabel ? { date: opts.dateLabel } : {}),
        }),
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
  const attentionText = createAttentionSafeTextAccumulator();
  let error: string | null = null;

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
            {
              const visible = attentionText.append(ev.text ?? "");
              opts.onText?.(visible);
            }
            break;
          case "assistant_replace":
            {
              const visible = attentionText.replace(ev.text ?? "");
              opts.onText?.(visible);
            }
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
  } catch (err) {
    if (opts.signal?.aborted) {
      error = "cancelled";
    } else {
      error ??= (err as Error)?.message ?? "the connection dropped mid-generation";
    }
  }

  // /api/chat/send appends the <coven:next-paths> suggestions directive to
  // every prompt, and a compliant familiar echoes the block back. The journal
  // has no chip row — strip it (terminated or truncated) so it never lands in
  // the stored reflection.
  const trimmed = extractNextPaths(error !== null ? attentionText.terminal() : attentionText.settled()).visible.trim();
  if (!trimmed && !error) error = "The familiar didn't return a reflection. Try again.";
  return { text: trimmed, error };
}

export type JournalGenerateErrorCopy = {
  /** What happened, as a short status line. */
  headline: string;
  /** What to do about it. */
  hint: string;
  /** The raw message, shown behind a Details disclosure. */
  detail: string;
};

/**
 * Turn a raw generation/persistence failure into copy that says what happened
 * and what to do. The raw message stays available as `detail` — the mapping
 * only ever adds context, it never hides the original.
 */
export function describeJournalGenerateError(raw: string | null | undefined, familiarName?: string | null): JournalGenerateErrorCopy {
  const detail = (raw ?? "").trim() || "No error message was returned.";
  const who = familiarName?.trim() || "The familiar";
  const m = detail.toLowerCase();
  const copy = (headline: string, hint: string): JournalGenerateErrorCopy => ({ headline, hint, detail });

  if (/changed while the reflection was being written|\bconflict\b/.test(m)) {
    return copy(
      "The entry changed while the reflection was being written",
      "Cave reloaded the latest version instead of overwriting it. Review it, then generate again if you still want a new one.",
    );
  }
  if (/save the generated reflection|could not save|couldn't save/.test(m)) {
    return copy(
      "The reflection was written but couldn't be saved",
      "Check that Cave can write to ~/.coven/journal, then retry.",
    );
  }
  if (m === "cancelled" || /\baborted\b|\bcancell?ed\b/.test(m)) {
    return copy("Reflection cancelled", "Generate again when you're ready.");
  }
  if (/timed? ?out|timeout|etimedout|deadline|chat bridge 504/.test(m)) {
    return copy(
      `${who} took too long to reflect`,
      "The familiar didn't answer in time. Retry, or try again once it has finished other work.",
    );
  }
  if (/daemon|econnrefused|enoent.*sock|offline|unavailable|not running|chat bridge 50[23]/.test(m)) {
    return copy(
      "Couldn't reach the Coven daemon",
      "Reflections are written through the daemon. Start it (Settings › Daemon), then retry.",
    );
  }
  if (/didn't return a reflection|no reflection was returned|empty (reply|response)/.test(m)) {
    return copy(`${who} didn't write anything`, "The reply came back empty. Retry to ask again.");
  }
  if (/connection dropped|failed to fetch|fetch failed|network|socket hang up|econnreset/.test(m)) {
    return copy(
      "The connection dropped mid-reflection",
      "Check that Cave's server is still running, then retry.",
    );
  }
  if (/familiar reported an error|generation error/.test(m)) {
    return copy(
      `${who} couldn't finish the reflection`,
      "Its runtime reported a failure without details. Retry, or open a chat with the familiar to check that its runtime is working.",
    );
  }
  if (/chat bridge 4\d\d/.test(m)) {
    return copy(
      "Cave couldn't start the reflection",
      "The request was refused. Retry; if it keeps failing, check the familiar's runtime settings.",
    );
  }
  if (/pick a familiar|summon a familiar/.test(m)) {
    return copy("No familiar to write the reflection", "Summon a familiar first — reflections are written by one.");
  }
  return copy("Couldn't generate the reflection", "Retry. If it keeps failing, open Details for the full message.");
}
