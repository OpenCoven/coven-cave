"use client";

import { useEffect, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { TerminalPane } from "@/components/terminal-pane";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiar: Familiar | null;
  sessions: SessionRow[];
  onResponseNeededChange?: (familiarId: string, needed: boolean) => void;
};

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null };

export function ChatRouter({ familiar, sessions, onResponseNeededChange }: Props) {
  const [view, setView] = useState<View>({ kind: "list" });

  // Switching familiars always drops you back to the chats list
  useEffect(() => {
    setView({ kind: "list" });
  }, [familiar?.id]);

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
        onOpen={(sessionId) => setView({ kind: "chat", sessionId })}
        onNewChat={() => setView({ kind: "chat", sessionId: null })}
      />
    );
  }

  return (
    <TerminalPane
      familiar={familiar}
      attachSessionId={view.sessionId}
      onBack={() => setView({ kind: "list" })}
      onResponseNeededChange={onResponseNeededChange}
    />
  );
}
