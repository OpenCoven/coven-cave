"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatView } from "@/components/chat-view";
import { useIsMobile } from "@/lib/use-viewport";
import type { Familiar, SessionRow } from "@/lib/types";

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null; projectRoot?: string; initialPrompt?: string };

type Props = {
  familiar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSessionStarted?: () => void;
  onSessionsChanged?: () => void;
  onSlashFromChat?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  pendingProjectRoot?: string | null;
  /** Route back to the linked board task from the chat header. */
  onOpenTask?: (cardId: string) => void;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: (projectRoot?: string, initialPrompt?: string) => void;
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
    sessions,
    daemonRunning,
    onSessionStarted,
    onSessionsChanged,
    onSlashFromChat,
    onOpenOnboarding,
    pendingProjectRoot,
    onOpenTask,
  },
  ref,
) {
  const [view, setView] = useState<View>({ kind: "list" });
  const viewHandle = useRef<ChatViewHandle | null>(null);
  const previousFamiliarIdRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const activeSession = view.kind === "chat" && view.sessionId
    ? sessions.find((s) => s.id === view.sessionId) ?? null
    : null;

  useEffect(() => {
    if (previousFamiliarIdRef.current === null) {
      previousFamiliarIdRef.current = familiar?.id ?? null;
      return;
    }
    if (previousFamiliarIdRef.current === (familiar?.id ?? null)) return;
    previousFamiliarIdRef.current = familiar?.id ?? null;
    setView((prev) =>
      prev.kind === "chat"
        ? { kind: "chat", sessionId: null, projectRoot: prev.projectRoot }
        : { kind: "list" },
    );
  }, [familiar?.id]);

  useImperativeHandle(
    ref,
    () => ({
      goToList: () => setView({ kind: "list" }),
      newChat: (projectRoot?: string, initialPrompt?: string) =>
        setView({ kind: "chat", sessionId: null, projectRoot, initialPrompt }),
      openSession: (sessionId: string) => setView({ kind: "chat", sessionId }),
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [view],
  );

  if (!familiar) {
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
        sessions={sessions}
        daemonRunning={daemonRunning}
        onOpen={(sessionId) => setView({ kind: "chat", sessionId })}
        onNewChat={(projectRoot) => setView({ kind: "chat", sessionId: null, projectRoot })}
      />
    );
  }

  return (
    <ChatView
      ref={viewHandle}
      familiar={familiar}
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
            ? { kind: "chat", sessionId: sid }
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
