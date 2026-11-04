"use client";

// Past Ask Salem answers (mode "salem"). The standalone assistant was retired
// (#6399): asking now happens in search and the compact Salem panel. This view
// keeps the thread that surface saved readable, exportable and deletable, and
// opens the panel in place, because phone widths have no split panes. It reads
// localStorage only, so opening it sends no requests until someone asks.

import { useState } from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { SalemChatPanel } from "@/components/salem/salem-widget";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  clearThread,
  loadThread,
  threadToMarkdown,
  type AskSalemMessage,
} from "@/lib/salem/ask-salem-thread";

function downloadThread(messages: readonly AskSalemMessage[]) {
  const url = URL.createObjectURL(new Blob([threadToMarkdown(messages)], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ask-salem-history.md";
  link.click();
  URL.revokeObjectURL(url);
}

export function SalemHistoryView({
  familiarId,
  model,
}: {
  familiarId?: string | null;
  model?: string | null;
}) {
  const [messages, setMessages] = useState<AskSalemMessage[]>(() =>
    typeof window === "undefined" ? [] : loadThread(window.localStorage),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [asking, setAsking] = useState(false);
  const { announce } = useAnnouncer();

  if (asking) {
    return (
      <SalemChatPanel familiarId={familiarId} model={model} onShowHistory={() => setAsking(false)} />
    );
  }

  if (messages.length === 0) {
    return (
      <section className="flex h-full items-center justify-center p-6" aria-label="Salem history">
        <EmptyState
          icon="ph:cat"
          headline="No saved Salem answers"
          subtitle="Ask Salem here, or type a question in search."
          actions={<Button variant="primary" onClick={() => setAsking(true)}>Ask Salem</Button>}
        />
      </section>
    );
  }

  return (
    <section className="salem-history flex h-full min-w-0 flex-col" aria-label="Salem history">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--text-primary)]">Salem history</h2>
          <p className="text-[length:var(--text-sm)] text-muted-foreground">
            Saved in this browser.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setAsking(true)}>Ask Salem</Button>
          <Button
            variant="secondary"
            onClick={() => {
              downloadThread(messages);
              announce("Salem history exported.");
            }}
          >
            Export
          </Button>
          {confirmingDelete ? (
            <>
              <Button
                variant="danger"
                onClick={() => {
                  clearThread(window.localStorage);
                  setMessages([]);
                  setConfirmingDelete(false);
                  announce("Salem history deleted.");
                }}
              >
                Delete history
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>Delete…</Button>
          )}
        </div>
      </header>
      <div className="salem-panel__messages min-h-0 flex-1 overflow-y-auto">
        {messages.map((message, index) => (
          <div key={`${message.at ?? index}-${index}`} className={`salem-msg salem-msg--${message.role}`}>
            {message.role === "salem" ? (
              <div className="salem-msg__md"><MarkdownBlock text={message.text} /></div>
            ) : (
              <span className="salem-msg__text">{message.text}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
