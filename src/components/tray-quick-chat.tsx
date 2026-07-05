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
import type { Familiar } from "@/lib/types";

function initials(familiar: Familiar): string {
  return (familiar.display_name || familiar.id)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TrayQuickChat() {
  const {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId,
    selectedFamiliar,
    draft,
    setDraft,
    answer,
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
  } = useQuickChat();

  const sending = sendState === "sending";

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!sending) void send();
      }
    },
    [send, sending],
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
        <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="ph:chat-circle-dots" width={18} aria-hidden />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Quick Chat</h1>
              <p className="truncate text-xs text-[var(--fg-muted)]">
                {/* Mirror the in-app overlay: loading is not "no familiar". */}
                {loading ? "Loading familiars…" : selectedFamiliar ? `@${selectedFamiliar.id}` : "No familiar selected"}
              </p>
            </div>
          </div>
          <IconButton
            onClick={openFullSession}
            disabled={!sessionId}
            icon="ph:arrow-square-out"
            aria-label="Open in CovenCave"
            title="Open in CovenCave"
            size="sm"
          />
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
          <Icon name="ph:at" width={14} aria-hidden />
          <StandardSelect
            label="Familiar"
            value={selectedFamiliarId ?? ""}
            onChange={(next) => setSelectedFamiliarId(next || null)}
            disabled={loading || familiars.length === 0}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] bg-transparent text-sm outline-none"
            options={
              loading && familiars.length === 0
                ? [{ value: "", label: "Loading…", disabled: true }]
                : familiars.map((familiar) => ({ value: familiar.id, label: familiar.display_name }))
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
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

        <div className="flex-1 overflow-auto px-4 py-3">
          {selectedFamiliar ? (
            <div className="mb-3 flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              {selectedFamiliar.avatarUrl ? (
                <img
                  src={selectedFamiliar.avatarUrl}
                  alt=""
                  className="h-6 w-6 rounded-sm object-cover"
                />
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-sm bg-[var(--bg-elevated)] text-[10px] font-semibold text-[var(--fg-primary)]">
                  {initials(selectedFamiliar)}
                </span>
              )}
              <span className="min-w-0 truncate">{selectedFamiliar.role}</span>
            </div>
          ) : null}

          <label className="block text-xs font-medium text-[var(--fg-muted)]" htmlFor="quick-chat-draft">
            Message
          </label>
          <textarea
            id="quick-chat-draft"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="@sage summarize what needs attention"
            className="mt-2 h-28 w-full resize-none rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-presence)]"
          />

          {error ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--fg-primary)]">
              <span className="min-w-0 truncate">{error}</span>
              <Button
                size="xs"
                onClick={() => void send()}
                disabled={sending}
              >
                Retry
              </Button>
            </div>
          ) : null}

          <div
            className="mt-3 min-h-32 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] p-3 text-sm"
            aria-live="polite"
          >
            {answer ? (
              <p className="whitespace-pre-wrap leading-6">{answer}</p>
            ) : sending ? (
              <p className="text-[var(--fg-muted)]">Thinking...</p>
            ) : (
              <p className="text-[var(--fg-muted)]">The reply will appear here.</p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-hairline)] px-4 py-3">
          <p className="min-w-0 truncate text-xs text-[var(--fg-muted)]">
            Use @id to switch familiars. ⌘↵ to send.
          </p>
          <div className="flex items-center gap-2">
            {sending ? (
              <Button
                variant="secondary"
                onClick={cancel}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              variant="primary"
              leadingIcon="ph:sparkle"
              onClick={() => void send()}
              disabled={sending || loading}
            >
              Send
            </Button>
          </div>
        </footer>
      </section>
    </main>
  );
}
