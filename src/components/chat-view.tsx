"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { canonicalize, formatHelp, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";

type Turn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
  error?: boolean;
  durationMs?: number;
};

type Props = {
  familiar: Familiar;
  sessionId: string | null;
  daemonRunning?: boolean;
  onSessionStarted?: (sessionId: string) => void;
  onBack?: () => void;
  onSlashCommand?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
};

export type ChatViewHandle = {
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};

type StreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; text: string }
  | { kind: "assistant_chunk"; text: string }
  | { kind: "done"; durationMs?: number; isError?: boolean; sessionId?: string }
  | { kind: "error"; message: string; code?: string };

function fmtDuration(ms?: number): string | null {
  if (!ms || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { familiar, sessionId, daemonRunning, onSessionStarted, onBack, onSlashCommand, onOpenOnboarding },
  ref,
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSessionRef = useRef<string | null>(sessionId);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const keys = useKeySymbols();

  // Slash suggestions
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = input.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || input.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [input]);
  const [slashIdx, setSlashIdx] = useState(0);

  useEffect(() => {
    setSlashIdx(0);
  }, [input]);

  // Load history on attach; new chats open with the /help block visible
  useEffect(() => {
    currentSessionRef.current = sessionId;
    if (!sessionId) {
      setTurns([
        {
          id: "help-bootstrap",
          role: "system",
          text: formatHelp(),
        },
      ]);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/chat/conversation/${sessionId}`, { cache: "no-store" });
        if (!res.ok) {
          setTurns([]);
          return;
        }
        const json = await res.json();
        if (json.ok && json.conversation) {
          setTurns(
            json.conversation.turns
              .filter((t: { role: string }) => t.role === "user" || t.role === "assistant")
              .map(
                (t: { id: string; role: "user" | "assistant"; text: string; durationMs?: number }) => ({
                  id: t.id,
                  role: t.role,
                  text: t.text,
                  durationMs: t.durationMs,
                }),
              ),
          );
        }
      } catch {
        /* fall through */
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const appendSystem = (text: string) => {
    setTurns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "system", text },
    ]);
  };

  const runCovenExec = async (subcommand: "doctor" | "daemon") => {
    appendSystem(`$ coven ${subcommand}${subcommand === "daemon" ? " status" : ""}\nrunning…`);
    try {
      const res = await fetch("/api/coven/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: subcommand }),
      });
      const json = await res.json();
      const out = [json.stdout, json.stderr].filter(Boolean).join("\n").trim();
      appendSystem(
        json.ok
          ? `coven ${subcommand} — exit 0\n\n${out || "(no output)"}`
          : `coven ${subcommand} — failed${json.exitCode != null ? ` (exit ${json.exitCode})` : ""}\n\n${out || json.error || "(no output)"}`,
      );
    } catch (err) {
      appendSystem(
        `coven ${subcommand} — error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  };

  const intentFromSlash = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("/")) return false;
    const space = trimmed.indexOf(" ");
    const token = space < 0 ? trimmed : trimmed.slice(0, space);
    const args = space < 0 ? "" : trimmed.slice(space + 1).trim();
    const command = canonicalize(token) ?? token;

    if (command === "/clear") {
      setTurns([]);
      setInput("");
      return true;
    }
    if (command === "/help") {
      appendSystem(formatHelp());
      setInput("");
      return true;
    }
    if (command === "/doctor" || command === "/daemon") {
      setInput("");
      void runCovenExec(command === "/doctor" ? "doctor" : "daemon");
      return true;
    }
    // Workspace-level commands routed through the parent
    if (onSlashCommand?.(command, args)) {
      setInput("");
      return true;
    }
    // /run, /codex, /claude — fall through into a normal send
    if (command === "/run" || command === "/codex" || command === "/claude") {
      if (!args.trim()) return true;
      setInput("");
      setTimeout(() => sendRaw(args), 0);
      return true;
    }
    // Unknown slash command: surface inline rather than send to the harness
    appendSystem(`Unknown command: ${token}. Try /help.`);
    setInput("");
    return true;
  };

  const sendRaw = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);

    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", text };
    const assistantId = crypto.randomUUID();
    const assistantTurn: Turn = { id: assistantId, role: "assistant", text: "", pending: true };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: familiar.id,
          prompt: text,
          sessionId: currentSessionRef.current,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setError(`request failed (${res.status})`);
        markAssistantError(assistantId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith("data:")) continue;
          const payload = frame.slice(5).trim();
          if (!payload) continue;
          try {
            const ev = JSON.parse(payload) as StreamEvent;
            handleEvent(ev, assistantId);
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, pending: false, text: t.text || "(cancelled)" }
              : t,
          ),
        );
      } else {
        setError(err instanceof Error ? err.message : "send failed");
        markAssistantError(assistantId);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const cancelSend = () => {
    abortRef.current?.abort();
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (intentFromSlash(text)) return;
    setInput("");
    await sendRaw(text);
  };

  const handleEvent = (ev: StreamEvent, assistantId: string) => {
    switch (ev.kind) {
      case "session": {
        if (!currentSessionRef.current) {
          currentSessionRef.current = ev.sessionId;
          onSessionStarted?.(ev.sessionId);
        }
        return;
      }
      case "assistant_chunk": {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, text: (t.text + ev.text).replace(/\n{3,}/g, "\n\n"), pending: true }
              : t,
          ),
        );
        return;
      }
      case "done": {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, pending: false, error: ev.isError ?? false, durationMs: ev.durationMs }
              : t,
          ),
        );
        if (ev.sessionId && !currentSessionRef.current) {
          currentSessionRef.current = ev.sessionId;
          onSessionStarted?.(ev.sessionId);
        }
        return;
      }
      case "error": {
        setError(ev.message);
        markAssistantError(assistantId);
        if (ev.code === "ENOENT") onOpenOnboarding?.();
        return;
      }
    }
  };

  const markAssistantError = (id: string) => {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pending: false, error: true } : t)),
    );
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = slashSuggestions[slashIdx];
        if (cmd) setInput(cmd.name + (cmd.argPlaceholder ? " " : ""));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === "Escape" && busy) {
      e.preventDefault();
      cancelSend();
    }
  };

  const projectName = "home";

  useImperativeHandle(
    ref,
    () => ({
      clearTranscript: () => setTurns([]),
      runSlash: (command: string) => {
        // Push command into the composer + dispatch
        if (command === "/clear") {
          setTurns([]);
          return;
        }
        if (command === "/help") {
          intentFromSlash("/help");
          return;
        }
        // For commands that need args, just prefill the composer
        setInput(command + " ");
        inputRef.current?.focus();
      },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <section className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* Compact status row */}
      <header className="flex items-center gap-2 border-b border-zinc-900 px-5 py-2.5 text-[11px] text-zinc-400">
        {onBack ? (
          <button
            onClick={onBack}
            className="rounded border border-zinc-800 px-1.5 py-0.5 text-zinc-300 transition-colors hover:bg-zinc-900"
            title="Back to chats"
          >
            ← chats
          </button>
        ) : null}
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
        <span className="ml-auto text-zinc-500">
          {busy ? (
            <span className="text-amber-400">streaming…</span>
          ) : currentSessionRef.current ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Icon name="ph:circle-fill" width="0.5rem" height="0.5rem" />
              live
            </span>
          ) : (
            <span>new</span>
          )}
        </span>
      </header>

      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {turns.length === 0 ? (
            <div className="py-14 text-center text-sm text-zinc-500">
              <p className="text-zinc-300">Chat with {familiar.display_name}.</p>
              <p className="mt-1 text-zinc-500">
                Runs on{" "}
                <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[12px] text-zinc-300">
                  {familiar.harness}
                </code>{" "}
                via the{" "}
                <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[12px] text-zinc-300">
                  coven
                </code>{" "}
                CLI. {keys.mod}K to jump · / for commands.
              </p>
            </div>
          ) : null}
          {turns.map((t) => (
            <TurnRow key={t.id} turn={t} />
          ))}
          <div ref={tailRef} />
        </div>
      </div>

      {error ? (
        <div className="border-t border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      ) : null}

      {/* Composer — Codex style */}
      <footer className="px-5 pb-5 pt-2">
        <div className="relative mx-auto max-w-3xl">
          {slashSuggestions.length > 0 ? (
            <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl">
              <ul className="max-h-64 overflow-y-auto py-1">
                {slashSuggestions.map((cmd, i) => {
                  const active = i === slashIdx;
                  return (
                    <li key={cmd.name}>
                      <button
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => {
                          setInput(cmd.name + (cmd.argPlaceholder ? " " : ""));
                          inputRef.current?.focus();
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-zinc-800/60" : "hover:bg-zinc-900/50"
                        }`}
                      >
                        <span className="font-mono text-zinc-200">{cmd.name}</span>
                        <span className="flex-1 truncate text-xs text-zinc-500">
                          {cmd.description}
                        </span>
                        {cmd.argPlaceholder ? (
                          <span className="font-mono text-[10px] text-zinc-600">
                            {cmd.argPlaceholder}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
                {keys.up}{keys.down} navigate · {keys.enter} run · Tab complete · esc cancel
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-lg">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={busy ? "Streaming… (esc to cancel)" : "Ask for follow-up changes"}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1 text-zinc-500">
                <button
                  className="grid h-7 w-7 place-items-center rounded-full border border-zinc-800 hover:bg-zinc-800"
                  title="Attach (coming soon)"
                  disabled
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <span className="flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-1 text-[11px]">
                  <span className="text-purple-300">◆</span>
                  <span className="font-mono text-zinc-300">{familiar.model ?? "—"}</span>
                </span>
                {busy ? (
                  <button
                    onClick={cancelSend}
                    className="grid h-7 w-7 place-items-center rounded-full bg-rose-500/90 text-white transition-colors hover:bg-rose-500"
                    title="Cancel (esc)"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!input.trim()}
                    className="grid h-7 w-7 place-items-center rounded-full bg-zinc-100 text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
                    title={`Send (${keys.enter})`}
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
            <span>↵ send · ⇧↵ newline · / commands · ⌘K palette</span>
            <span className="font-mono">
              {familiar.harness} · {familiar.model ?? ""}
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
});

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.role === "system") {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-4 py-3 font-mono text-[12px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
        {turn.text}
      </div>
    );
  }
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-zinc-800/70 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-100">
          <RichText text={turn.text} />
        </div>
      </div>
    );
  }
  // Assistant — plain, no bubble
  const duration = fmtDuration(turn.durationMs);
  return (
    <div className="text-[14px] leading-relaxed text-zinc-200">
      {duration && !turn.pending ? (
        <div className="mb-2 flex items-center gap-1 text-[11px] text-zinc-500">
          <span>Worked for {duration}</span>
          <span>›</span>
        </div>
      ) : null}
      <div className={turn.error ? "text-amber-200" : ""}>
        <RichText text={turn.text || (turn.pending ? "…" : "")} />
        {turn.pending && turn.text ? (
          <span className="ml-1 inline-block animate-pulse text-zinc-400">▌</span>
        ) : null}
      </div>
    </div>
  );
}
