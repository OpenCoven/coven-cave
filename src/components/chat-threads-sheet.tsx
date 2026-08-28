"use client";

// The mobile route to the thread list (cave-fh9so).
//
// On desktop the list is a docked rail beside the conversation, with a spine to
// reopen it when collapsed. Below 1024px there is no room for a third column,
// so `chat-inner-rail.css` hides BOTH the rail and its spine — which would
// leave the session list unreachable on a phone, since it no longer lives in
// the app sidebar either. This is that route: the same list, hosted in a
// left-edge slide-over, mirroring the code rail's own mobile sheet on the
// opposite edge.
//
// Selecting a thread dismisses the sheet. A slide-over that stayed open over
// the conversation it just navigated to would cover the thing you asked for.

import { useRef } from "react";
import { SidebarChatsSection } from "@/components/workspace-sidebar";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { SessionRow } from "@/lib/types";

export function ChatThreadsSheet({
  open,
  onClose,
  sessions,
  activeFamiliarId,
  activeSessionId,
  onOpenSession,
  onDeleteSession,
  onSessionsChanged,
  onOpenUrl,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  activeSessionId: string | null;
  onOpenSession: (session: SessionRow) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  onSessionsChanged?: () => void;
  onOpenUrl?: (url: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, panelRef, { onEscape: onClose });
  if (!open) return null;
  return (
    <div className="chat-threads-sheet fixed inset-0 z-[200] flex justify-start" role="presentation">
      <button
        type="button"
        aria-label="Close chat list"
        className="absolute inset-0 bg-[var(--backdrop-scrim)]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="chat-threads-sheet__panel relative flex h-full w-[min(88vw,320px)] flex-col bg-[var(--bg-base)] shadow-[8px_0_32px_rgba(0,0,0,0.2)] [padding-bottom:var(--sai-bottom)] [padding-top:var(--sai-top)]"
        role="dialog"
        aria-modal="true"
        aria-label="Chat threads"
        tabIndex={-1}
      >
        <SidebarChatsSection
          sessions={sessions}
          activeFamiliarId={activeFamiliarId}
          activeSessionId={activeSessionId}
          onOpenSession={(session) => {
            onOpenSession(session);
            onClose();
          }}
          onDeleteSession={onDeleteSession}
          onSessionsChanged={onSessionsChanged}
          onOpenUrl={onOpenUrl}
          onCollapse={onClose}
          collapseLabel="Close chat list"
        />
      </div>
    </div>
  );
}
