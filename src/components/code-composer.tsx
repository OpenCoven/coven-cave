"use client";

/**
 * CodeComposer — the workbench's "Ask for follow-up changes" box (cave-k0ua):
 * sends a prompt to the SELECTED session's agent through the sanctioned
 * client LLM path (streamFamiliarText → /api/chat/send with sessionId, the
 * same resume the chat surface uses) and shows a compact tail of the reply
 * as it streams. The full transcript stays in Chat — Open in Chat jumps
 * there. Stop cancels the run via /api/chat/stop with the send's runId.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { SessionRow } from "@/lib/types";

type Phase = { kind: "idle" } | { kind: "streaming"; runId: string } | { kind: "done" } | { kind: "error"; message: string };

/** Last few lines of the streamed reply — a peek, not a transcript. */
function replyTail(text: string, lines = 3): string {
  const all = text.trimEnd().split("\n");
  return all.slice(-lines).join("\n");
}

export function CodeComposer({
  row,
  onJumpToSession,
}: {
  row: SessionRow;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [reply, setReply] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase.kind === "streaming";

  async function send() {
    const trimmed = prompt.trim();
    if (!trimmed || busy || !row.familiarId) return;
    const runId = `code-composer-${Date.now().toString(36)}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "streaming", runId });
    setReply("");
    setPrompt("");
    // No projectRoot rides on the resume: the server derives the cwd from the
    // conversation record (or the daemon's session record), which is where the
    // session actually lives — including `.worktrees/` checkouts. Asserting
    // the worktree root here made the send an explicit unregistered-project
    // request that fails closed (403), the same class #2238 fixed in Chat.
    let result: Awaited<ReturnType<typeof streamFamiliarText>>;
    try {
      result = await streamFamiliarText({
        familiarId: row.familiarId,
        sessionId: row.id,
        prompt: trimmed,
        runId,
        signal: controller.signal,
        onText: setReply,
      });
    } catch (err) {
      // A mid-stream abort (Stop) rejects the reader — keep whatever streamed
      // so far and only surface non-abort failures (see use-quick-chat.ts).
      if (abortRef.current === controller) abortRef.current = null;
      if (controller.signal.aborted) {
        setPhase({ kind: "done" });
      } else {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : "Generation failed." });
        setPrompt(trimmed); // let the user retry without retyping
      }
      return;
    }
    abortRef.current = null;
    if (controller.signal.aborted) {
      setPhase({ kind: "done" });
      return;
    }
    if (result.error && !result.text) {
      setPhase({ kind: "error", message: result.error });
      setPrompt(trimmed); // let the user retry without retyping
      return;
    }
    setReply(result.text);
    setPhase({ kind: "done" });
  }

  async function stop() {
    if (phase.kind !== "streaming") return;
    // Ask the bridge to stop the run, then drop the stream client-side too.
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: phase.runId, sessionId: row.id }),
      });
    } catch {
      /* the local abort below still ends the stream */
    }
    abortRef.current?.abort();
  }

  return (
    <div className="shrink-0 border-t border-[var(--border-hairline)] px-4 py-3">
      {reply && phase.kind !== "idle" ? (
        <div className="mb-2 flex items-start justify-between gap-3 text-[length:var(--text-xs)]">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-[var(--text-secondary)]">
            {replyTail(reply)}
          </pre>
          <button
            type="button"
            className="focus-ring shrink-0 rounded px-1 text-[length:var(--text-2xs)] text-[var(--text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]"
            onClick={() => onJumpToSession(row.id, row.familiarId)}
          >
            Full thread in Chat
          </button>
        </div>
      ) : null}
      {phase.kind === "error" ? (
        <p role="alert" className="mb-2 text-[length:var(--text-xs)] text-[var(--color-danger)]">
          {phase.message}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          className="focus-ring-inset min-h-9 w-full resize-y rounded border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          rows={2}
          placeholder={busy ? "The familiar is working…" : "Ask for follow-up changes…"}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
          aria-label="Ask for follow-up changes"
        />
        {busy ? (
          <Button size="sm" variant="danger-ghost" onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!prompt.trim() || !row.familiarId} onClick={() => void send()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
