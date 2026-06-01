"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatView } from "@/components/chat-view";
import type { Familiar, SessionRow } from "@/lib/types";

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null; projectRoot?: string };

type Props = {
  familiar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSessionStarted?: () => void;
  onSlashFromChat?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: () => void;
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
  { familiar, sessions, daemonRunning, onSessionStarted, onSlashFromChat, onOpenOnboarding },
  ref,
) {
  const [view, setView] = useState<View>({ kind: "list" });
  const viewHandle = useRef<ChatViewHandle | null>(null);

  useEffect(() => {
    setView({ kind: "list" });
  }, [familiar?.id]);

  useImperativeHandle(
    ref,
    () => ({
      goToList: () => setView({ kind: "list" }),
      newChat: () => setView({ kind: "chat", sessionId: null }),
      openSession: (sessionId: string) => setView({ kind: "chat", sessionId }),
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [view],
  );

  if (!familiar) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)] text-sm text-[var(--text-muted)]">
        <p>Pick a familiar from the rail to start chatting.</p>
        {onOpenOnboarding ? (
          <button
            onClick={onOpenOnboarding}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
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
      projectRoot={view.kind === "chat" ? view.projectRoot : undefined}
      daemonRunning={daemonRunning}
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
    />
  );
});
