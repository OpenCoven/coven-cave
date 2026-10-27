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

import type { ReactNode } from "react";
import { SidebarChatsSection } from "@/components/workspace-sidebar";
import { Modal } from "@/components/ui/modal";
import type { ChatBrowseScope } from "@/lib/chat-browse-scope";
import type { SessionRow } from "@/lib/types";

export function ChatThreadsSheet({
  open,
  onClose,
  sessions,
  reflectionSourceSessions,
  sessionsError = false,
  browseScope,
  outOfScopeActiveSession = null,
  activeFamiliarId,
  activeSessionId,
  onOpenSession,
  onDeleteSession,
  onSessionsChanged,
  onOpenUrl,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionRow[];
  /** Unscoped rows for the rail's Reflections section. */
  reflectionSourceSessions?: SessionRow[];
  sessionsError?: boolean;
  /** The project scope, so an empty or loading sheet says so (#5585). */
  browseScope?: ChatBrowseScope;
  outOfScopeActiveSession?: SessionRow | null;
  activeFamiliarId: string | null;
  activeSessionId: string | null;
  onOpenSession: (session: SessionRow) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  onSessionsChanged?: () => void;
  onOpenUrl?: (url: string) => void;
  /** The chat section tabs (#5529). On a phone an open thread folds the tabs
   *  strip away, so the sheet is where Sessions / Projects / Familiar live. */
  sections?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Chat threads" size="compact" presentation="sheet-left" bodyLayout="fill">
        {sections}
        <SidebarChatsSection
          sessions={sessions}
          reflectionSourceSessions={reflectionSourceSessions}
          sessionsError={sessionsError}
          browseScope={browseScope}
          outOfScopeActiveSession={outOfScopeActiveSession}
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
    </Modal>
  );
}
