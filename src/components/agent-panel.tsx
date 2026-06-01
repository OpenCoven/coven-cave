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

// AgentPanel — always-visible right-side column hosting the active
// familiar's live chat. Replaces the floating DockChat introduced in
// PR #25; the chat is now a first-class Shell pane rather than an
// overlay, so it survives mode switches (Board, Inbox, Plugins) and
// stays in the same place.
export const AgentPanel = forwardRef<ChatRouterHandle, Props>(function AgentPanel(
  props,
  ref,
) {
  if (!props.familiar) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-[12px] text-[--text-muted]">
        <p className="text-[--text-secondary]">Pick a familiar from the rail.</p>
        <p className="mt-1">Their live chat lives here.</p>
        <button
          type="button"
          onClick={props.onOpenOnboarding}
          className="mt-4 rounded-md border border-[--border-hairline] bg-[--bg-raised] px-3 py-1 text-[11px] text-[--text-primary] hover:bg-[--bg-raised]/80"
        >
          Open setup
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ChatRouter
        ref={ref}
        familiar={props.familiar}
        sessions={props.sessions}
        daemonRunning={props.daemonRunning}
        onSessionStarted={props.onSessionStarted}
        onSlashFromChat={props.onSlashFromChat}
        onOpenOnboarding={props.onOpenOnboarding}
      />
    </div>
  );
});
