"use client";

import { useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { OriginChip } from "@/components/ui/origin-chip";

const PROJECT_ROOT =
  process.env.NEXT_PUBLIC_COVEN_PROJECT_ROOT ??
  "/Users/buns/Documents/GitHub/OpenCoven/coven-cave";

type Props = {
  familiar: Familiar;
  sessions: SessionRow[];
  daemonRunning?: boolean;
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

export function ChatList({ familiar, sessions, daemonRunning, onOpen, onNewChat }: Props) {
  const [busyTuiId, setBusyTuiId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useKeySymbols();

  const mine = useMemo(() => {
    return sessions
      .filter((s) => s.familiarId === familiar.id)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [sessions, familiar.id]);

  const openInTui = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setBusyTuiId(sessionId);
    setError(null);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "attach", sessionId }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "launch failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "launch failed");
    } finally {
      setBusyTuiId(null);
    }
  };

  const projectName = PROJECT_ROOT.split("/").slice(-2).join("/");

  return (
    <section className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <header className="flex items-center gap-2 border-b border-zinc-900 px-5 py-2.5 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-100">{familiar.display_name}</span>
        </span>
        <span className="text-zinc-700">·</span>
        <span className="font-mono text-zinc-500">{familiar.harness ?? "codex"}</span>
        <span className="text-zinc-700">·</span>
        <span className="truncate font-mono text-zinc-500">{projectName}</span>
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-500">
          daemon{" "}
          <span className={daemonRunning ? "text-emerald-400" : "text-rose-400"}>
            {daemonRunning ? "running" : "offline"}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={onNewChat}
            className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            + New chat
          </button>
        </span>
      </header>

      {error ? (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-4 text-xs uppercase tracking-widest text-zinc-500">
            Chats with {familiar.display_name}
          </h2>

          {mine.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
              <p className="text-sm text-zinc-300">No chats with {familiar.display_name} yet.</p>
              <p className="mt-1 text-[12px] text-zinc-500">
                Runs on{" "}
                <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
                  {familiar.harness}
                </code>{" "}
                with{" "}
                <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
                  {familiar.model}
                </code>
                .
              </p>
              <button
                onClick={onNewChat}
                className="mt-5 rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white"
              >
                + New chat
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-900">
              {mine.map((s) => {
                const running = s.status === "running";
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpen(s.id);
                      }}
                      className="group flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-zinc-900/30"
                    >
                      <Icon
                        name={running ? "ph:circle-fill" : "ph:circle"}
                        className={
                          running ? "text-emerald-400 animate-pulse" : "text-zinc-700"
                        }
                        title={running ? "running" : "idle"}
                        width="0.6rem"
                        height="0.6rem"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm text-zinc-100">
                            {s.title || "(untitled chat)"}
                          </span>
                          {s.origin ? <OriginChip origin={s.origin} /> : null}
                        </span>
                        <span className="truncate text-[11px] text-zinc-500">
                          <span className="font-mono text-zinc-400">{s.harness}</span>
                          <span className="mx-1.5 text-zinc-700">·</span>
                          <span className="truncate">{s.project_root}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">{age(s.updated_at)}</span>
                      <button
                        onClick={(e) => openInTui(e, s.id)}
                        disabled={busyTuiId === s.id}
                        title="Open this session in Coven Code TUI (external terminal)"
                        className="shrink-0 rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-800 group-hover:opacity-100 disabled:opacity-40"
                      >
                        {busyTuiId === s.id ? "…" : "tui"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <footer className="border-t border-zinc-900 px-5 py-2 text-[10px] text-zinc-600">
        {keys.enter} open · {keys.mod}K palette · / commands in chat
      </footer>
    </section>
  );
}
