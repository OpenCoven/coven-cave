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

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { streamFamiliarText } from "@/lib/familiar-stream";
import {
  CODE_COMPOSER_STATUS,
  buildCodeFollowUp,
  codeComposerOutcome,
  codeComposerReplyTail,
  codeComposerSuggestions,
} from "@/lib/code-composer-context";
import { codeComboChips } from "@/lib/code-shortcuts";
import { composerRuns } from "@/lib/code-composer-runs";
import { codeDeskMemory } from "@/lib/code-desk-memory";
import type { SessionRow } from "@/lib/types";


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
  /** False while the session has no folder, or its folder is gone (#5795). */
  hasProject?: boolean;
  /** An unsent draft restored for this session (#5718). */
  initialDraft?: string;
  /** Reports every edit so the desk can keep the draft across session switches. */
  onDraftChange?: (draft: string) => void;
};

export function CodeComposer({
  row,
  onJumpToSession,
  contextPath = null,
  rangeLabel = null,
  hasChanges = false,
  hasPr = false,
  hasProject = true,
  initialDraft = "",
  onDraftChange,
}: CodeComposerProps) {
  const id = useId();
  const [prompt, setPrompt] = useState(initialDraft);
  // The run lives in a per-session store, not here (#5729): this composer is
  // remounted for every session switch, and a run kept in component state was
  // orphaned by one — Send re-enabled, Stop unreachable, the outcome lost.
  const sessionId = row.id;
  const run = useSyncExternalStore(
    composerRuns.subscribe,
    () => composerRuns.read(sessionId),
    () => composerRuns.read(sessionId),
  );
  const phase = run.phase;
  const reply = run.reply;
  const [includeContext, setIncludeContext] = useState(true);
  const [apple, setApple] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = phase === "streaming";
  const fileName = contextPath ? baseName(contextPath) : null;
  const attached = includeContext && Boolean(contextPath);
  const suggestions = useMemo(
    () => codeComposerSuggestions({ fileName, hasChanges, hasPr, hasProject }),
    [fileName, hasChanges, hasPr, hasProject],
  );

  useEffect(() => {
    setApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  // Every edit, a send that clears the field, and a failed send that puts the
  // text back all flow through `prompt`, so one effect keeps the memory true.
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current?.(prompt);
  }, [prompt]);

  // An unanswered ask comes back to the field (a failure or a Stop before any
  // text) — including one that finished while this session was not on screen.
  useEffect(() => {
    if (run.restore === null) return;
    const restored = run.restore;
    setPrompt((current) => (current.trim() ? current : restored));
    composerRuns.ackRestore(sessionId);
  }, [run.restore, sessionId]);

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
    if (!composerRuns.begin(sessionId, runId, controller)) return;
    setPrompt("");
    // No projectRoot rides on the resume: the server derives the cwd from the
    // conversation record (or the daemon's session record), which is where the
    // session actually lives — including `.worktrees/` checkouts. Asserting
    // the worktree root here made the send an explicit unregistered-project
    // request that fails closed (403), the same class #2238 fixed in Chat.
    //
    // From here on, everything goes through the store, never component state:
    // this composer may be unmounted before the reply ends.
    const result = await streamFamiliarText({
      familiarId: row.familiarId,
      sessionId: row.id,
      prompt: outgoing,
      runId,
      signal: controller.signal,
      onText: (text) => composerRuns.reply(sessionId, runId, text),
    });
    const outcome = codeComposerOutcome({
      text: result.text,
      error: result.error,
      stoppedByReader: composerRuns.wasStopped(sessionId, runId),
    });
    const restore = outcome.restorePrompt ? typed : null;
    // If the composer is gone, its field will start from the session's memory.
    if (restore && !codeDeskMemory.read(sessionId)?.draft) codeDeskMemory.write(sessionId, { draft: restore });
    composerRuns.finish(sessionId, runId, {
      phase: outcome.phase,
      reply: result.text,
      message: outcome.message,
      restore,
    });
  }

  function stop() {
    // Abort first: the reply must stop now, not after a round trip. Then tell
    // the bridge, best effort — the local abort already ended the stream.
    const runId = composerRuns.stop(sessionId);
    if (!runId) return;
    void fetch("/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, sessionId }),
    }).catch(() => {
      /* nothing to do: the stream is already closed on this side */
    });
  }

  const showReply = phase !== "idle" && (reply.length > 0 || phase !== "done");
  const showSuggestions = Boolean(row.familiarId) && !prompt.trim() && !busy && suggestions.length > 0;
  const sendChips = codeComboChips("Mod+Enter", apple);

  return (
    <section className="code-composer" aria-label="Follow-up" data-testid="code-composer">
      {showReply ? (
        <div className="code-composer__reply" data-phase={phase} data-testid="code-composer-reply">
          <div className="code-composer__reply-head">
            {/* The status is a WORD beside the mark, never the mark alone. */}
            <span className="code-composer__status" role="status" data-phase={phase}>
              {phase === "streaming" ? (
                <span className="code-composer__status-dot" aria-hidden="true" />
              ) : (
                <Icon
                  name={phase === "error" ? "ph:warning-circle" : phase === "stopped" ? "ph:x-circle" : "ph:check"}
                  width={11}
                  height={11}
                  aria-hidden
                />
              )}
              {CODE_COMPOSER_STATUS[phase]}
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
          {phase === "error" && run.message ? (
            <p role="alert" className="code-composer__error">
              {run.message}
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

      {!row.familiarId ? (
        // Say why Send is off (#5729): a disabled control with no reason
        // reads as broken.
        <p className="code-composer__note" id={`${id}-no-familiar`}>
          No familiar is attached to this session, so follow-ups can&rsquo;t be sent from here.
          <button
            type="button"
            className="focus-ring code-composer__link"
            onClick={() => onJumpToSession(row.id, row.familiarId)}
          >
            Continue in Chat
          </button>
        </p>
      ) : null}

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
          // Read-only, not disabled, while a reply streams (#5729): disabling
          // the focused field dropped keyboard focus on the page.
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-describedby={row.familiarId ? `${id}-hint` : `${id}-hint ${id}-no-familiar`}
        />
        {busy ? (
          <Button size="sm" variant="danger-ghost" onClick={stop}>
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
