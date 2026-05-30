"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatView } from "@/components/chat-view";
import type { Familiar, SessionRow } from "@/lib/types";

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null };

type Props = {
  familiar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSessionStarted?: () => void;
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
  { familiar, sessions, daemonRunning, onSessionStarted },
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
      <section className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Pick a familiar from the rail to start chatting.
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
        onNewChat={() => setView({ kind: "chat", sessionId: null })}
      />
    );
  }

  return (
    <ChatView
      ref={viewHandle}
      familiar={familiar}
      sessionId={view.sessionId}
      daemonRunning={daemonRunning}
      onBack={() => setView({ kind: "list" })}
      onSessionStarted={(sid) => {
        setView({ kind: "chat", sessionId: sid });
        onSessionStarted?.();
      }}
    />
  );
});
