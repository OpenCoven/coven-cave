"use client";

import { useCallback } from "react";
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
import { FamiliarMark, QuickChatSelect, QuickChatThread } from "@/components/quick-chat-controls";

// One-tap starters for a cold thread — they fill the composer, not send.
const TRAY_SUGGESTIONS = [
  "Summarize what needs my attention",
  "Draft a short status update",
  "What changed recently?",
];

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

  const onKeyDown = useCallback(
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
          <div className="flex min-w-0 items-center gap-2">
            {selectedFamiliar ? (
              <FamiliarMark familiar={selectedFamiliar} size="md" />
            ) : (
              <Icon name="ph:chat-circle-dots" width={20} aria-hidden />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {selectedFamiliar ? selectedFamiliar.display_name : "Quick Chat"}
              </h1>
              <p className="truncate text-xs text-[var(--fg-muted)]">
                {/* Mirror the in-app overlay: loading is not "no familiar". */}
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
              onClick={openFullSession}
              disabled={!sessionId}
              icon="ph:arrow-square-out"
              aria-label="Open in CovenCave"
              title="Open in CovenCave"
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
          suggestions={TRAY_SUGGESTIONS}
          onSuggestion={setDraft}
          onRegenerate={sending ? undefined : regenerate}
        />

        <footer className="quick-chat-overlay__composer">
          {error ? (
            <p className="quick-chat-overlay__error" role="alert">
              {error}
            </p>
          ) : null}
          <textarea
            id="quick-chat-draft"
            value={draft}
            autoFocus
            aria-label="Message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={selectedFamiliar ? `Message @${selectedFamiliar.id}…` : "@sage summarize what needs attention"}
            className="quick-chat-overlay__input"
          />
          <div className="quick-chat-overlay__actions">
            <p className="min-w-0 truncate text-xs text-[var(--fg-muted)]">
              @id switches familiars · ⌘↵ to send
            </p>
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
      </section>
    </main>
  );
}
