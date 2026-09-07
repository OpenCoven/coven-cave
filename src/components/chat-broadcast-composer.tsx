"use client";

/**
 * The broadcast composer (cave-g7yg6) — write once, send into every selected
 * chat.
 *
 * Deliberately small: one textarea and one verb. It is not a chat view, and it
 * never shows replies. Each target answers in its own thread, which is where
 * the user reads it; a panel that streamed N replies here would be a second
 * chat surface competing with the real ones.
 *
 * It posts ONE request to /api/chat/broadcast and reports the per-target result
 * array back to the caller. The fan-out, its concurrency ceiling and the
 * per-familiar resolution all live on the server — see that route.
 */

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { BroadcastResult } from "@/lib/chat-broadcast";

export function ChatBroadcastComposer({
  count,
  targets,
  onClose,
  onSent,
}: {
  /** How many chats this will reach — named in the heading and the verb. */
  count: number;
  targets: readonly string[];
  onClose: () => void;
  onSent: (results: BroadcastResult[]) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusTrap(true, panelRef, { onEscape: () => (busy ? undefined : onClose()) });

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmed = text.trim();

  async function send() {
    if (!trimmed || busy || targets.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, targets: targets.map((sessionId) => ({ sessionId })) }),
      });
      const data: { ok?: boolean; error?: string; results?: BroadcastResult[] } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !Array.isArray(data.results)) {
        setError(data.error ?? `broadcast failed with ${res.status}`);
        return;
      }
      // Partial failure is NOT an error state here — the caller renders the
      // per-row outcome, so a mixed result still closes the composer with the
      // failures visible in the list behind it.
      onSent(data.results);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "broadcast failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-broadcast fixed inset-0 z-[220] flex items-center justify-center" role="presentation">
      <button
        type="button"
        aria-label="Cancel broadcast"
        className="absolute inset-0 bg-[var(--backdrop-scrim)]"
        onClick={() => (busy ? undefined : onClose())}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Broadcast to ${count} chat${count === 1 ? "" : "s"}`}
        tabIndex={-1}
        className="chat-broadcast__panel relative flex w-[min(92vw,520px)] flex-col gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)]"
      >
        <h2 className="chat-broadcast__title">
          Broadcast to {count} chat{count === 1 ? "" : "s"}
        </h2>
        <p className="chat-broadcast__note">
          Each chat answers on its own. Replies land in their own threads, not here.
        </p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={5}
          placeholder="Message to send to every selected chat…"
          className="chat-broadcast__input focus-ring"
          disabled={busy}
        />
        {error ? (
          <p role="alert" className="chat-broadcast__error">
            <Icon name="ph:warning-circle" width={13} aria-hidden /> {error}
          </p>
        ) : null}
        <div className="chat-broadcast__actions">
          <button type="button" className="focus-ring chat-broadcast__cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="focus-ring chat-broadcast__send"
            onClick={() => void send()}
            disabled={!trimmed || busy}
          >
            {busy ? "Sending…" : `Send to ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
