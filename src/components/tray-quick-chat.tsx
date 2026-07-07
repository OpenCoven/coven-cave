"use client";

import { useCallback } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { useQuickChat } from "@/lib/use-quick-chat";
import {
  QuickChatComposer,
  QuickChatControlsRow,
  QuickChatIdentity,
  QuickChatThread,
  useSuggestionPicker,
} from "@/components/quick-chat-controls";

export function TrayQuickChat() {
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
  } = useQuickChat();

  const sending = sendState === "sending";
  const { composerRef, pickSuggestion } = useSuggestionPicker(setDraft);

  const openFullSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("quick-chat:open-session", { sessionId, familiarId: selectedFamiliarId });
    } catch {
      window.location.href = `/#chat-${encodeURIComponent(sessionId)}`;
    }
  }, [selectedFamiliarId, sessionId]);

  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--fg-primary)]">
      <section className="flex min-h-screen flex-col border border-[var(--border-hairline)] bg-[var(--bg-panel)]">
        {/* The tray window is created with decorations(false) (see lib.rs), so
            without a drag region it cannot be moved at all. Tauri's injected
            drag.js turns any empty-chrome press in this subtree into a native
            window drag (`deep` semantics; the icon buttons still block it),
            gated by capabilities/loopback-window-drag.json. Inert in plain
            browsers. */}
        <header className="quick-chat-overlay__header" data-tauri-drag-region="deep">
          <QuickChatIdentity familiar={selectedFamiliar} loading={loading} as="h1" />
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
              onClick={openFullSession}
              disabled={!sessionId}
              icon="ph:arrow-square-out"
              aria-label="Open in CovenCave"
              title="Open in CovenCave"
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
          inputId="quick-chat-draft"
          composerRef={composerRef}
          autoFocus
          leading={
            <p className="min-w-0 truncate text-xs text-[var(--fg-muted)]">
              @id switches familiars · Enter to send
            </p>
          }
        />
      </section>
    </main>
  );
}
