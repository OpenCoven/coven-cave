"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useQuickChat } from "@/lib/use-quick-chat";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  QuickChatComposer,
  QuickChatControlsRow,
  QuickChatIdentity,
  QuickChatThread,
  useSuggestionPicker,
} from "@/components/quick-chat-controls";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenFullSession?: (sessionId: string, familiarId?: string | null) => void;
  /** The workspace's active familiar — the popover defaults to it (a manual
   *  pick in the popover still wins once made). */
  activeFamiliarId?: string | null;
};

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
    // The overlay mounts closed at app boot — defer the roster fetch until the
    // dropdown is actually opened.
  } = useQuickChat({ preferredFamiliarId: activeFamiliarId ?? null, enabled: open });

  const sending = sendState === "sending";
  const dialogRef = useRef<HTMLDivElement>(null);
  const { composerRef, pickSuggestion } = useSuggestionPicker(setDraft);

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
  }, [open, composerRef]);

  const openFull = useCallback(() => {
    if (!sessionId) return;
    onOpenFullSession?.(sessionId, selectedFamiliarId);
    onClose();
  }, [onClose, onOpenFullSession, selectedFamiliarId, sessionId]);

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
          <QuickChatIdentity familiar={selectedFamiliar} loading={loading} />
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

        <QuickChatControlsRow
          loading={loading}
          familiars={familiars}
          selectedFamiliarId={selectedFamiliarId}
          onPickFamiliar={setSelectedFamiliarId}
          thinkingEffort={thinkingEffort}
          onThinkingEffortChange={setThinkingEffort}
          responseSpeed={responseSpeed}
          onResponseSpeedChange={setResponseSpeed}
          sending={sending}
        />

        <QuickChatThread
          messages={messages}
          familiar={selectedFamiliar}
          onSuggestion={pickSuggestion}
          onRegenerate={sending ? undefined : regenerate}
        />

        <QuickChatComposer
          error={error}
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void send()}
          onCancel={cancel}
          sending={sending}
          disabled={loading}
          familiar={selectedFamiliar}
          inputId="quick-chat-overlay-draft"
          composerRef={composerRef}
          leading={
            <Button
              size="sm"
              variant="ghost"
              leadingIcon="ph:arrow-square-out"
              onClick={openFull}
              disabled={!sessionId}
            >
              Open in full chat
            </Button>
          }
        />
      </div>
    </>
  );
}
