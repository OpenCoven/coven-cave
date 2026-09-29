"use client";

/**
 * CodeComposer — the Coding Desk's follow-up dock (cave-k0ua, overhauled for
 * #5705): sends a prompt to the SELECTED session's agent through the
 * sanctioned client LLM path (streamFamiliarText → /api/chat/send with
 * sessionId, the same resume the chat surface uses) and shows a compact tail
 * of the reply as it streams. The full transcript stays in Chat — Open in
 * Chat jumps there. Stop cancels the run via /api/chat/stop with the send's
 * runId.
 *
 * What the overhaul added, and why. The box was a bare textarea under a desk
 * that already knew which file you were reading and whether the session had
 * changes or a PR. Now: a persistent label (a placeholder is not a label), a
 * context chip that attaches the open file and the handed-off range to the
 * ask, state-gated suggestion pills that SEED the prompt rather than send it,
 * and a reply card with a status word beside the tail. The text that rides
 * to the bridge is built by `buildCodeFollowUp`, so a test can pin exactly
 * what the chip changes.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { streamFamiliarText } from "@/lib/familiar-stream";
import {
  CODE_COMPOSER_STATUS,
  buildCodeFollowUp,
  codeComposerReplyTail,
  codeComposerSuggestions,
} from "@/lib/code-composer-context";
import { codeComboChips } from "@/lib/code-shortcuts";
import type { SessionRow } from "@/lib/types";

type Phase = { kind: "idle" } | { kind: "streaming"; runId: string } | { kind: "done" } | { kind: "error"; message: string };

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

export type CodeComposerProps = {
  row: SessionRow;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  /** The file in the viewer, as the desk prints it (repo-relative when known). */
  contextPath?: string | null;
  /** The handed-off selection, e.g. "lines 12–30". */
  rangeLabel?: string | null;
  hasChanges?: boolean;
  hasPr?: boolean;
};

export function CodeComposer({
  row,
  onJumpToSession,
  contextPath = null,
  rangeLabel = null,
  hasChanges = false,
  hasPr = false,
}: CodeComposerProps) {
  const id = useId();
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [reply, setReply] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [apple, setApple] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = phase.kind === "streaming";
  const fileName = contextPath ? baseName(contextPath) : null;
  const attached = includeContext && Boolean(contextPath);
  const suggestions = useMemo(
    () => codeComposerSuggestions({ fileName, hasChanges, hasPr }),
    [fileName, hasChanges, hasPr],
  );

  useEffect(() => {
    setApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  // A new file in the viewer re-arms the chip: "leave this one out" is a
  // decision about that file, not about every file opened after it.
  useEffect(() => {
    setIncludeContext(true);
  }, [contextPath]);

  async function send() {
    const outgoing = buildCodeFollowUp({ prompt, contextPath, rangeLabel, includeContext });
    const typed = prompt.trim();
    if (!outgoing || busy || !row.familiarId) return;
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
        prompt: outgoing,
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
        setPrompt(typed); // let the user retry without retyping
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
      setPrompt(typed); // let the user retry without retyping
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

  const showReply = phase.kind !== "idle" && (reply.length > 0 || phase.kind === "error" || phase.kind === "streaming");
  const showSuggestions = !prompt.trim() && !busy && suggestions.length > 0;
  const sendChips = codeComboChips("Mod+Enter", apple);

  return (
    <section className="code-composer" aria-label="Follow-up" data-testid="code-composer">
      {showReply ? (
        <div className="code-composer__reply" data-phase={phase.kind} data-testid="code-composer-reply">
          <div className="code-composer__reply-head">
            {/* The status is a WORD beside the mark, never the mark alone. */}
            <span className="code-composer__status" role="status" data-phase={phase.kind}>
              {phase.kind === "streaming" ? (
                <span className="code-composer__status-dot" aria-hidden="true" />
              ) : (
                <Icon name={phase.kind === "error" ? "ph:warning-circle" : "ph:check"} width={11} height={11} aria-hidden />
              )}
              {CODE_COMPOSER_STATUS[phase.kind]}
            </span>
            <span className="code-composer__spacer" />
            <button
              type="button"
              className="focus-ring code-composer__link"
              onClick={() => onJumpToSession(row.id, row.familiarId)}
            >
              Full thread in Chat
            </button>
          </div>
          {phase.kind === "error" ? (
            <p role="alert" className="code-composer__error">
              {phase.message}
            </p>
          ) : null}
          {reply ? <pre className="code-composer__tail">{codeComposerReplyTail(reply)}</pre> : null}
        </div>
      ) : null}

      <div className="code-composer__meta">
        <label className="code-composer__label" htmlFor={`${id}-prompt`}>
          Follow-up
        </label>
        {contextPath ? (
          <button
            type="button"
            className="focus-ring code-composer__chip"
            aria-pressed={attached}
            title={attached ? `${contextPath} rides with the ask. Click to leave it out.` : `Attach ${contextPath} to the ask.`}
            onClick={() => setIncludeContext((on) => !on)}
            data-testid="code-composer-context"
          >
            <Icon name="ph:paperclip" width={11} height={11} aria-hidden />
            <span className="code-composer__chip-name">{fileName}</span>
            {rangeLabel ? <span className="code-composer__chip-note">{rangeLabel}</span> : null}
            <span className="code-composer__chip-state">{attached ? "attached" : "not attached"}</span>
          </button>
        ) : null}
        <span className="code-composer__spacer" />
        <span className="code-composer__hint" id={`${id}-hint`}>
          {sendChips.map((chip) => (
            <kbd key={chip} className="code-composer__kbd">
              {chip}
            </kbd>
          ))}
          to send
        </span>
      </div>

      {showSuggestions ? (
        <div
          className="code-composer__suggestions"
          role="group"
          aria-label="Suggested follow-ups"
          data-count={suggestions.length}
          data-testid="code-composer-suggestions"
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="focus-ring code-composer__suggestion"
              onClick={() => {
                setPrompt(suggestion.prompt);
                textareaRef.current?.focus();
              }}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="code-composer__row">
        <textarea
          ref={textareaRef}
          id={`${id}-prompt`}
          className="focus-ring-inset code-composer__input"
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
          aria-describedby={`${id}-hint`}
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
    </section>
  );
}
