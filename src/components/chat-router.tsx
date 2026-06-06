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
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSessionStarted?: () => void;
  onSlashFromChat?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  onFamiliarSelect?: (id: string) => void;
  pendingProjectRoot?: string | null;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: (projectRoot?: string) => void;
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
    onSessionStarted,
    onSlashFromChat,
    onOpenOnboarding,
    onFamiliarSelect,
    pendingProjectRoot,
  },
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
      newChat: (projectRoot?: string) => setView({ kind: "chat", sessionId: null, projectRoot }),
      openSession: (sessionId: string) => setView({ kind: "chat", sessionId }),
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [view],
  );

  if (!familiar) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-secondary)]">
            Choose a familiar for this task
          </p>
          <p className="mt-1 text-[12px]">
            {pendingProjectRoot
              ? "This chat will start in the selected project."
              : "Pick who should handle the conversation."}
          </p>
        </div>
        {familiars.length > 0 ? (
          <div className="grid w-full max-w-[520px] gap-2 sm:grid-cols-2">
            {familiars.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFamiliarSelect?.(f.id)}
                className="min-w-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-left transition-colors hover:border-[var(--accent-presence)]/50 hover:bg-[var(--bg-raised)]/80"
              >
                <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {f.display_name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                  {f.role || f.harness || "Familiar"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
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
        onOpen={(sessionId) => setView({ kind: "chat", sessionId })}
        onNewChat={(projectRoot) => setView({ kind: "chat", sessionId: null, projectRoot })}
        onFamiliarSelect={onFamiliarSelect}
      />
    );
  }

  return (
    <ChatView
      ref={viewHandle}
      familiar={familiar}
      familiars={familiars}
      sessionId={view.sessionId}
      projectRoot={view.kind === "chat" ? view.projectRoot : undefined}
      daemonRunning={daemonRunning}
      onBack={() => setView({ kind: "list" })}
      onFamiliarSelect={onFamiliarSelect}
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
