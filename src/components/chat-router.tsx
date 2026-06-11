"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatView } from "@/components/chat-view";
import { useIsMobile } from "@/lib/use-viewport";
import type { Familiar, SessionRow } from "@/lib/types";

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null; projectRoot?: string; initialPrompt?: string; familiarId?: string | null };

type Props = {
  familiar: Familiar | null;
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSetActiveFamiliar?: (id: string) => void;
  onSessionStarted?: () => void;
  onSessionsChanged?: () => void;
  sessionsLoaded?: boolean;
  onSlashFromChat?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  pendingProjectRoot?: string | null;
  /** Route back to the linked board task from the chat header. */
  onOpenTask?: (cardId: string) => void;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null) => void;
  openSession: (sessionId: string) => void;
  currentSessionId: () => string | null;
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};


type ChatViewHandle = {
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};

export const ChatRouter = forwardRef<ChatRouterHandle, Props>(function ChatRouter(
  {
    familiar,
    familiars = [],
    sessions,
    daemonRunning,
    onSetActiveFamiliar,
    onSessionStarted,
    onSessionsChanged,
    sessionsLoaded,
    onSlashFromChat,
    onOpenOnboarding,
    pendingProjectRoot,
    onOpenTask,
  },
  ref,
) {
  const [view, setView] = useState<View>({ kind: "list" });
  const viewHandle = useRef<ChatViewHandle | null>(null);
  const previousFamiliarIdRef = useRef<string | null | undefined>(undefined);
  const isMobile = useIsMobile();
  const activeSession = view.kind === "chat" && view.sessionId
    ? sessions.find((s) => s.id === view.sessionId) ?? null
    : null;
  const fallbackFamiliar = familiars[0] ?? null;
  const selectedViewFamiliar = view.kind === "chat" && view.familiarId
    ? familiars.find((entry) => entry.id === view.familiarId) ?? null
    : null;
  const sessionFamiliar = activeSession?.familiarId
    ? familiars.find((entry) => entry.id === activeSession.familiarId) ?? null
    : null;
  const chatFamiliar = familiar ?? selectedViewFamiliar ?? sessionFamiliar ?? null;

  function selectFamiliarForChat(familiarId?: string | null): Familiar | null {
    const next = familiarId
      ? familiars.find((entry) => entry.id === familiarId) ?? null
      : familiar ?? fallbackFamiliar;
    if (next) onSetActiveFamiliar?.(next.id);
    return next;
  }

  useEffect(() => {
    const nextFamiliarId = familiar?.id ?? null;
    if (previousFamiliarIdRef.current === undefined) {
      previousFamiliarIdRef.current = nextFamiliarId;
      return;
    }
    if (previousFamiliarIdRef.current === nextFamiliarId) return;
    previousFamiliarIdRef.current = nextFamiliarId;
    setView((prev) =>
      nextFamiliarId === null
        ? { kind: "list" }
        : prev.kind === "chat"
          ? {
              kind: "chat",
              sessionId: null,
              projectRoot: prev.projectRoot,
              initialPrompt: prev.initialPrompt,
              familiarId: nextFamiliarId,
            }
        : { kind: "list" },
    );
  }, [familiar?.id]);

  useImperativeHandle(
    ref,
    () => ({
      goToList: () => setView({ kind: "list" }),
      newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null) => {
        const next = selectFamiliarForChat(familiarId);
        setView({
          kind: "chat",
          sessionId: null,
          projectRoot,
          initialPrompt,
          familiarId: next?.id ?? familiarId ?? null,
        });
      },
      openSession: (sessionId: string) => {
        const session = sessions.find((entry) => entry.id === sessionId);
        const next = selectFamiliarForChat(session?.familiarId ?? null);
        setView({ kind: "chat", sessionId, familiarId: next?.id ?? session?.familiarId ?? null });
      },
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [fallbackFamiliar, familiar, familiars, onSetActiveFamiliar, sessions, view],
  );

  if (familiars.length === 0 && !familiar) {
    // Empty-state copy is mode-aware: on phones the nav/sidebar/agent panels
    // are drawers behind a toggle, so "from the sidebar selector" / "left
    // panel" reads as broken. Point users at the drawer or the setup CTA
    // instead.
    const heading = isMobile
      ? "Choose a familiar to start chatting"
      : "Choose a familiar from the sidebar selector";
    const subline = pendingProjectRoot
      ? "Selecting one will start this chat in the pending project."
      : isMobile
        ? "Open the menu to pick a familiar, or set one up below."
        : "Pick who should handle the conversation from the left panel.";
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-secondary)]">
            {heading}
          </p>
          <p className="mt-1 text-[12px]">
            {subline}
          </p>
        </div>
        {onOpenOnboarding ? (
          <button
            onClick={onOpenOnboarding}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
          >
            Open setup
          </button>
        ) : null}
      </section>
    );
  }

  if (view.kind === "list") {
    return (
      <ChatList
        familiar={familiar}
        familiars={familiars}
        sessions={sessions}
        daemonRunning={daemonRunning}
        sessionsLoaded={sessionsLoaded}
        onSessionsChanged={onSessionsChanged}
        onOpen={(sessionId, familiarId) => {
          const next = selectFamiliarForChat(familiarId);
          setView({ kind: "chat", sessionId, familiarId: next?.id ?? familiarId ?? null });
        }}
        onNewChat={(projectRoot, familiarId) => {
          const next = selectFamiliarForChat(familiarId);
          setView({ kind: "chat", sessionId: null, projectRoot, familiarId: next?.id ?? familiarId ?? null });
        }}
      />
    );
  }

  if (!chatFamiliar) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-secondary)]">
            Choose a familiar to start chatting
          </p>
          <p className="mt-1 text-[12px]">
            Pick who should handle the conversation from the sidebar selector.
          </p>
        </div>
      </section>
    );
  }

  return (
    <ChatView
      ref={viewHandle}
      familiar={chatFamiliar}
      sessionId={view.sessionId}
      session={activeSession}
      projectRoot={view.kind === "chat" ? view.projectRoot : undefined}
      initialPrompt={view.kind === "chat" ? view.initialPrompt : undefined}
      daemonRunning={daemonRunning}
      onSessionsChanged={onSessionsChanged}
      onBack={() => setView({ kind: "list" })}
      onSessionStarted={(sid) => {
        // Only promote the sessionId in the view state when the current chat
        // has no session yet (null). If a session is already set, leave the
        // view alone — updating it would re-mount ChatView and lose the live
        // currentSessionRef, breaking follow-up messages.
        setView((prev) =>
          prev.kind === "chat" && prev.sessionId === null
            ? { kind: "chat", sessionId: sid, projectRoot: prev.projectRoot, familiarId: prev.familiarId }
            : prev,
        );
        onSessionStarted?.();
      }}
      onSlashCommand={onSlashFromChat}
      onOpenOnboarding={onOpenOnboarding}
      onOpenTask={onOpenTask}
    />
  );
});
