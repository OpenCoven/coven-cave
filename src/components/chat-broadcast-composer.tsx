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

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  broadcastResultAnnouncement,
  chatTargetLabel,
  type BroadcastResult,
} from "@/lib/chat-broadcast";

export function ChatBroadcastComposer({
  targets,
  onClose,
  onSent,
}: {
  targets: readonly string[];
  onClose: () => void;
  onSent: (results: BroadcastResult[]) => void;
}) {
  const descriptionId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  const trimmed = text.trim();
  const targetCount = targets.length;
  const requestClose = () => {
    if (!busy) onClose();
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
        const detail = data.error ?? `broadcast failed with ${res.status}`;
        const message = `Couldn't send this broadcast. ${detail}`;
        setError(message);
        announce(message, "assertive");
        return;
      }
      // Partial failure is NOT an error state here — the caller renders the
      // per-row outcome, so a mixed result still closes the composer with the
      // failures visible in the list behind it.
      const completion = broadcastResultAnnouncement(data.results);
      announce(completion.message, completion.level);
      onSent(data.results);
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "broadcast failed";
      const message = `Couldn't send this broadcast. ${detail}`;
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={requestClose}
      breadcrumb={["Chats", "Broadcast message"]}
      ariaDescribedBy={descriptionId}
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      focusFirst={false}
      footerActions={
        <>
          <Button variant="ghost" size="sm" onClick={requestClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:broadcast"
            onClick={() => void send()}
            disabled={!trimmed || targetCount === 0}
            loading={busy}
          >
            {busy ? `Sending to ${chatTargetLabel(targetCount)}…` : `Send to ${chatTargetLabel(targetCount)}`}
          </Button>
        </>
      }
    >
      <div className="chat-broadcast">
        <div className="chat-broadcast__scope">
          <span className="chat-broadcast__scope-icon" aria-hidden>
            <Icon name="ph:broadcast" width={16} aria-hidden />
          </span>
          <p id={descriptionId} className="chat-broadcast__note">
            One message is sent separately to {chatTargetLabel(targetCount)}. Replies stay in each chat.
          </p>
        </div>
        <label className="chat-broadcast__label" htmlFor={`${descriptionId}-message`}>
          Message
        </label>
        <textarea
          ref={textareaRef}
          id={`${descriptionId}-message`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={5}
          placeholder="Message selected chats…"
          className="chat-broadcast__input focus-ring"
          disabled={busy}
        />
        <p className="chat-broadcast__shortcut">
          <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send
        </p>
        {error ? (
          <p role="alert" className="chat-broadcast__error">
            <Icon name="ph:warning-circle" width={13} aria-hidden /> {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
