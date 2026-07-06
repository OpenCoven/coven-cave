"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StandardSelect } from "@/components/ui/select";
import { Icon } from "@/lib/icon";
import { useQuickChat } from "@/lib/use-quick-chat";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { FamiliarMark, QuickChatSelect, QuickChatThread } from "@/components/quick-chat-controls";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenFullSession?: (sessionId: string, familiarId?: string | null) => void;
  /** The workspace's active familiar — the popover defaults to it (a manual
   *  pick in the popover still wins once made). */
  activeFamiliarId?: string | null;
};

// One-tap starters for a cold thread — they fill the composer, not send.
const QUICK_CHAT_SUGGESTIONS = [
  "Summarize what needs my attention",
  "Draft a short status update",
  "What changed recently?",
];

export function QuickChatOverlay({ open, onClose, onOpenFullSession, activeFamiliarId }: Props) {
  const {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId,
    selectedFamiliar,
    draft,
    setDraft,
    messages,
    hasThread,
    error,
    sessionId,
    sendState,
    loading,
    thinkingEffort,
    setThinkingEffort,
    responseSpeed,
    setResponseSpeed,
    send,
    cancel,
    newThread,
    regenerate,
  } = useQuickChat({ preferredFamiliarId: activeFamiliarId ?? null });

  const sending = sendState === "sending";
  const dialogRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Anchor the popover directly beneath its menubar trigger so it reads as a
  // dropdown from the bar (with a caret pointing up at the icon) rather than a
  // panel pinned to the corner. Falls back to the CSS default (top-right) if the
  // trigger can't be measured. Recomputed on resize while open.
  const [anchor, setAnchor] = useState<{ top: number; right: number; caretRight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      // The trigger lives in the top bar, which is rendered per-breakpoint — pick
      // the visible instance (a hidden one reports a 0×0 rect). Its icon <svg> is
      // a leaf that keeps a real box even if the button itself doesn't, so fall
      // back to that to find the real on-screen position.
      const btns = Array.from(document.querySelectorAll("[data-quick-chat-trigger]"));
      const btn = btns.find((el) => el.getBoundingClientRect().width > 0) ?? btns[0] ?? null;
      let rect: DOMRect | undefined = btn?.getBoundingClientRect();
      if ((!rect || rect.width === 0) && btn) {
        rect = (btn.querySelector("svg") ?? btn.firstElementChild)?.getBoundingClientRect();
      }
      if (!rect || rect.width === 0) {
        setAnchor(null);
        return;
      }
      const right = Math.max(12, Math.round(window.innerWidth - rect.right));
      setAnchor({
        top: Math.round(rect.bottom + 8),
        right,
        // Centre the caret on the trigger icon (distance from the viewport right).
        caretRight: Math.max(14, Math.round(window.innerWidth - (rect.left + rect.width / 2) - 6)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  // Trap focus inside the dropdown while open: Tab cycles within it, Escape
  // closes it, and focus returns to the menubar trigger on close.
  useFocusTrap(open, dialogRef, { onEscape: onClose, focusFirst: false });

  // Land the caret in the composer on open. Deferred to an effect (not
  // `autoFocus`) so it runs *after* useFocusTrap has captured the trigger as
  // the return-focus target — otherwise autofocus would steal it and closing
  // wouldn't restore focus to the menubar button.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const cmdEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      // Enter sends; Shift+Enter inserts a newline; IME composition is left alone.
      const plainEnter =
        event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
      if (cmdEnter || plainEnter) {
        event.preventDefault();
        if (!sending && draft.trim()) void send();
      }
    },
    [draft, send, sending],
  );

  const openFull = useCallback(() => {
    if (!sessionId) return;
    onOpenFullSession?.(sessionId, selectedFamiliarId);
    onClose();
  }, [onClose, onOpenFullSession, selectedFamiliarId, sessionId]);

  const pickSuggestion = useCallback(
    (value: string) => {
      setDraft(value);
      // Move the caret into the composer so the user can tweak-and-send.
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [setDraft],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="quick-chat-overlay-backdrop"
        style={{ position: "fixed", inset: 0 }}
        onClick={onClose}
        aria-hidden
      />
      {anchor ? (
        <div
          className="quick-chat-overlay__caret"
          aria-hidden
          style={{ position: "fixed", top: anchor.top - 5, right: anchor.caretRight, zIndex: 1201 }}
        />
      ) : null}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick chat"
        className="quick-chat-overlay"
        style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
      >
        <header className="quick-chat-overlay__header">
          <div className="flex min-w-0 items-center gap-2">
            {selectedFamiliar ? (
              <FamiliarMark familiar={selectedFamiliar} size="md" />
            ) : (
              <Icon name="ph:chat-circle-dots" width={20} aria-hidden />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {selectedFamiliar ? selectedFamiliar.display_name : "Quick chat"}
              </h2>
              <p className="truncate text-xs text-[var(--fg-muted)]">
                {/* While the roster loads, say so — "No familiar selected" reads
                    as an error/empty state when it's really just cold. */}
                {loading ? "Loading familiars…" : selectedFamiliar ? `@${selectedFamiliar.id}` : "No familiar selected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              onClick={newThread}
              disabled={!hasThread}
              icon="ph:plus"
              aria-label="New chat"
              title="New chat"
              size="sm"
            />
            <IconButton
              onClick={onClose}
              icon="ph:x"
              aria-label="Close quick chat"
              title="Close"
              size="sm"
            />
          </div>
        </header>

        <div className="quick-chat-overlay__controls">
          <QuickChatSelect
            label="Familiar"
            value={selectedFamiliarId ?? ""}
            onChange={(next) => setSelectedFamiliarId(next || null)}
            disabled={loading || familiars.length === 0}
            className="flex-1"
            options={
              loading && familiars.length === 0
                ? [{ value: "", label: "Loading…", disabled: true }]
                : familiars.map((familiar) => ({
                    value: familiar.id,
                    label: familiar.display_name,
                    leading: <FamiliarMark familiar={familiar} size="sm" />,
                  }))
            }
          />
          <StandardSelect
            label="Choose thinking effort"
            value={thinkingEffort}
            onChange={(next) => setThinkingEffort(next as CommandThinkingEffort)}
            disabled={sending}
            className="min-w-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs outline-none"
            options={COMMAND_THINKING_OPTIONS}
          />
          <StandardSelect
            label="Choose response speed"
            value={responseSpeed}
            onChange={(next) => setResponseSpeed(next as CommandResponseSpeed)}
            disabled={sending}
            className="min-w-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs outline-none"
            options={COMMAND_RESPONSE_SPEED_OPTIONS}
          />
        </div>

        <QuickChatThread
          messages={messages}
          familiar={selectedFamiliar}
          emptyIcon="ph:chat-circle-dots"
          emptyTitle={selectedFamiliar ? `Ask ${selectedFamiliar.display_name} anything` : "Ask a familiar anything"}
          emptyHint="Replies stream right here · @name to switch familiar · Enter to send"
          suggestions={QUICK_CHAT_SUGGESTIONS}
          onSuggestion={pickSuggestion}
          onRegenerate={sending ? undefined : regenerate}
        />

        <footer className="quick-chat-overlay__composer">
          {error ? (
            <p className="quick-chat-overlay__error" role="alert">
              {error}
            </p>
          ) : null}
          <textarea
            ref={composerRef}
            id="quick-chat-overlay-draft"
            value={draft}
            aria-label="Message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={selectedFamiliar ? `Message @${selectedFamiliar.id}…` : "@sage summarize what needs attention"}
            className="quick-chat-overlay__input"
          />
          <div className="quick-chat-overlay__actions">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon="ph:arrow-square-out"
              onClick={openFull}
              disabled={!sessionId}
            >
              Open in full chat
            </Button>
            <div className="flex items-center gap-2">
              {sending ? (
                <Button variant="secondary" size="sm" onClick={cancel}>
                  Stop
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                leadingIcon="ph:sparkle"
                onClick={() => void send()}
                disabled={sending || loading || !draft.trim()}
              >
                Send
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
