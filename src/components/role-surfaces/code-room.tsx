"use client";

/**
 * Code Workshop — the Coding familiar's room (cave-cc5r).
 *
 * A thin adapter that mounts the existing CodeView inside the Role Surface
 * chrome. The workbench itself is unchanged; this file only translates the
 * room contract (RoleSurfaceContext) into CodeView's props:
 *
 *  - sessions come familiar-scoped from the context (the active familiar's
 *    own sessions plus unattributed ones), so the room's rail reads as "your
 *    coding familiar's work" rather than the whole Cave;
 *  - navigation and shell services (open a chat session, spotlight a Board
 *    card, refresh GitHub feeds) ride the context's generic callbacks;
 *  - file/diff opens raised anywhere in the shell arrive through the
 *    pending-code-open module store — Workspace enqueues + navigates here,
 *    the room consumes;
 *  - GitHub URL opens now enter this room through the pending navigation
 *    store after the role surface mounts.
 *
 * Pending code-open behavior is unchanged: file/diff routing still comes from
 * the dedicated pending-code-open store.
 */

import { useSyncExternalStore } from "react";
import { CodeView } from "@/components/code-view";
import {
  clearPendingCodeOpen,
  getPendingCodeOpen,
  subscribePendingCodeOpen,
} from "@/lib/pending-code-open";
import {
  acknowledgePendingCodeNavigation,
  getPendingCodeNavigation,
  subscribePendingCodeNavigation,
} from "@/lib/pending-code-navigation";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";

export function CodeRoom({ context }: { context: RoleSurfaceContext }) {
  const pendingOpen = useSyncExternalStore(
    subscribePendingCodeOpen,
    getPendingCodeOpen,
    () => null,
  );
  const pendingNavigation = useSyncExternalStore(
    subscribePendingCodeNavigation,
    getPendingCodeNavigation,
    () => null,
  );
  return (
    <CodeView
      sessions={context.runtimeState.sessions}
      onJumpToSession={(sessionId, familiarId) => context.openSession(sessionId, familiarId ?? undefined)}
      onFocusCard={context.focusCard}
      navigationRequest={pendingNavigation}
      onNavigationHandled={acknowledgePendingCodeNavigation}
      pendingOpen={pendingOpen}
      onPendingOpenHandled={clearPendingCodeOpen}
      onTasksRefresh={context.refreshTasks}
    />
  );
}
