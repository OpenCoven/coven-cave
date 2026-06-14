"use client";

import { forwardRef } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning: boolean;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
};

export const FamiliarPanel = forwardRef<ChatRouterHandle, Props>(function FamiliarPanel(
  props,
  ref,
) {
  const {
    familiar,
    onOpenOnboarding,
    sessions,
    daemonRunning,
    onSessionStarted,
    onSlashFromChat,
  } = props;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!familiar ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[12px] text-[var(--text-muted)]">
          <p className="text-[var(--text-secondary)]">Pick a familiar from the sidebar selector.</p>
          <p className="mt-1">Their live chat lives here.</p>
          <button
            type="button"
            onClick={onOpenOnboarding}
            className="mt-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
          >
            Open setup
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatRouter
            ref={ref}
            familiar={familiar}
            sessions={sessions}
            daemonRunning={daemonRunning}
            onSessionStarted={onSessionStarted}
            onSlashFromChat={onSlashFromChat}
            onOpenOnboarding={onOpenOnboarding}
            compact
          />
        </div>
      )}
    </div>
  );
});
