"use client";

import { useMemo } from "react";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiar: Familiar;
  sessions: SessionRow[];
  onOpen: (sessionId: string) => void;
  onNewChat: () => void;
};

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ChatList({ familiar, sessions, onOpen, onNewChat }: Props) {
  const mine = useMemo(() => {
    return sessions
      .filter((s) => s.familiarId === familiar.id)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [sessions, familiar.id]);

  return (
    <section className="flex h-full flex-col bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-lg">{familiar.emoji}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{familiar.display_name}</div>
            <div className="truncate text-[11px] text-zinc-500">
              {familiar.harness ?? "?"} ·{" "}
              <span className="font-mono">{familiar.model ?? "?"}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onNewChat}
          className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-violet-500"
        >
          + New chat
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {mine.length === 0 ? (
          <div className="mx-auto mt-12 max-w-sm text-center text-sm text-zinc-500">
            <p className="mb-3 text-zinc-400">
              No chats with {familiar.display_name} yet.
            </p>
            <p className="text-xs text-zinc-600">
              Start one — {familiar.display_name} runs on{" "}
              <span className="font-mono text-zinc-400">{familiar.harness}</span> with{" "}
              <span className="font-mono text-zinc-400">{familiar.model}</span>.
            </p>
            <button
              onClick={onNewChat}
              className="mt-5 rounded-md bg-violet-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              + New chat
            </button>
          </div>
        ) : (
          <ul className="space-y-1">
            {mine.map((s) => {
              const running = s.status === "running";
              return (
                <li key={s.id}>
                  <button
                    onClick={() => onOpen(s.id)}
                    className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-zinc-800 hover:bg-zinc-900/60"
                  >
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        running ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                      }`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-zinc-100">
                          {s.title || "(untitled chat)"}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                          {age(s.updated_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                        <span className="rounded bg-zinc-800 px-1 py-px font-mono text-zinc-400">
                          {s.harness}
                        </span>
                        <span className="truncate">{s.project_root}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
