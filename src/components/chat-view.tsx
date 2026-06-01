"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { canonicalize, formatHelp, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";

type ToolEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
};

type Turn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  tools?: ToolEvent[];
  createdAt: string;
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
  | { kind: "tool_use"; id?: string; name: string; input?: string; output?: string; status?: "running" | "ok" | "error"; durationMs?: number }
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

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Split assistant text into visible body + accumulated reasoning. We treat any
 * `<thinking>...</thinking>` or `<reasoning>...</reasoning>` block (both
 * commonly emitted by Claude/Codex harnesses) as reasoning to be collapsed.
 * Unclosed blocks fall through as visible text — they become reasoning once
 * the closing tag arrives in a later chunk.
 */
function splitReasoning(text: string): { visible: string; reasoning: string } {
  const reasoningParts: string[] = [];
  const visible = text.replace(
    /<(thinking|reasoning)>([\s\S]*?)<\/\1>/g,
    (_m, _tag, inner) => {
      reasoningParts.push(inner.trim());
      return "";
    },
  );
  return {
    visible: visible.replace(/\n{3,}/g, "\n\n").trimStart(),
    reasoning: reasoningParts.join("\n\n").trim(),
  };
}

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { familiar, sessionId, onSessionStarted, onSlashCommand, onOpenOnboarding },
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
          createdAt: new Date().toISOString(),
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
                (t: { id: string; role: "user" | "assistant"; text: string; durationMs?: number; createdAt?: string }) => ({
                  id: t.id,
                  role: t.role,
                  text: t.text,
                  durationMs: t.durationMs,
                  createdAt: t.createdAt ?? new Date().toISOString(),
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
      {
        id: crypto.randomUUID(),
        role: "system",
        text,
        createdAt: new Date().toISOString(),
      },
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

    const now = new Date().toISOString();
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: now,
    };
    const assistantId = crypto.randomUUID();
    const assistantTurn: Turn = {
      id: assistantId,
      role: "assistant",
      text: "",
      pending: true,
      createdAt: now,
      tools: [],
    };
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
      case "tool_use": {
        const incoming: ToolEvent = {
          id: ev.id ?? crypto.randomUUID(),
          name: ev.name,
          input: ev.input,
          output: ev.output,
          status: ev.status ?? "running",
          durationMs: ev.durationMs,
        };
        setTurns((prev) =>
          prev.map((t) => {
            if (t.id !== assistantId) return t;
            const tools = t.tools ?? [];
            const existingIdx = tools.findIndex((x) => x.id === incoming.id);
            const nextTools =
              existingIdx >= 0
                ? tools.map((x, i) =>
                    i === existingIdx
                      ? {
                          ...x,
                          ...incoming,
                          // Preserve previously captured input/output if the
                          // update doesn't supply them.
                          input: incoming.input ?? x.input,
                          output: incoming.output ?? x.output,
                        }
                      : x,
                  )
                : [...tools, incoming];
            return { ...t, tools: nextTools };
          }),
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
    <section className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          {turns.length === 0 ? (
            <div className="py-14 text-center text-sm text-[var(--text-muted)]">
              <p className="text-[var(--text-secondary)]">Chat with {familiar.display_name}.</p>
              <p className="mt-1 text-[var(--text-muted)]">
                Runs on{" "}
                <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[12px] text-[var(--text-secondary)]">
                  {familiar.harness}
                </code>{" "}
                via the{" "}
                <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[12px] text-[var(--text-secondary)]">
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
      <footer className="px-6 pb-5 pt-2">
        <div className="relative">
          {slashSuggestions.length > 0 ? (
            <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
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
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <span className="font-mono text-[var(--text-primary)]">{cmd.name}</span>
                        <span className="flex-1 truncate text-xs text-[var(--text-muted)]">
                          {cmd.description}
                        </span>
                        {cmd.argPlaceholder ? (
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            {cmd.argPlaceholder}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {keys.up}{keys.down} navigate · {keys.enter} run · Tab complete · esc cancel
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/50 shadow-lg">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={busy ? "Streaming… (esc to cancel)" : "Ask for follow-up changes"}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1 text-[var(--text-muted)]">
                <button
                  className="grid h-7 w-7 place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]"
                  title="Attach (coming soon)"
                  disabled
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <span className="flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-1 text-[11px]">
                  <span className="text-purple-300">◆</span>
                  <span className="font-mono text-[var(--text-secondary)]">{familiar.model ?? "—"}</span>
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
                    className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-presence)] text-white transition-colors hover:bg-[var(--accent-presence-soft)] disabled:opacity-40"
                    title={`Send (${keys.enter})`}
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
});

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.role === "system") {
    return (
      <div>
        <div className="rounded-xl border border-[var(--border-hairline)]/60 bg-[var(--bg-raised)]/40 px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
          {turn.text}
        </div>
        <div className="mt-1 text-right text-[10px] text-[var(--text-muted)]">{fmtTime(turn.createdAt)}</div>
      </div>
    );
  }
  if (turn.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl bg-[var(--bg-raised)]/70 px-4 py-2.5 text-[14px] leading-relaxed text-[var(--text-primary)]">
          <RichText text={turn.text} />
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">{fmtTime(turn.createdAt)}</div>
      </div>
    );
  }
  // Assistant — plain, no bubble
  const duration = fmtDuration(turn.durationMs);
  const { visible, reasoning } = splitReasoning(turn.text);
  const tools = turn.tools ?? [];
  return (
    <div className="text-[14px] leading-relaxed text-[var(--text-primary)]">
      {tools.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          {tools.map((t) => (
            <ToolBlock key={t.id} tool={t} />
          ))}
        </div>
      ) : null}
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      <div className={turn.error ? "text-amber-200" : ""}>
        <RichText text={visible || (turn.pending ? "…" : "")} />
        {turn.pending && visible ? (
          <span className="ml-1 inline-block animate-pulse text-[var(--text-secondary)]">▌</span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
        <span>{fmtTime(turn.createdAt)}</span>
        {duration && !turn.pending ? (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <span>worked for {duration}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lineCount = text.split("\n").length;
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-[var(--border-hairline)]/70 bg-[var(--bg-raised)]/30 text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]/60"
      >
        <Icon
          name="ph:caret-right-bold"
          width="0.7rem"
          height="0.7rem"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[var(--text-secondary)]">reasoning</span>
        <span className="text-[var(--text-muted)]">· {lineCount} line{lineCount === 1 ? "" : "s"}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)]/70 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function ToolBlock({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const statusDot =
    tool.status === "running"
      ? "bg-amber-400 animate-pulse"
      : tool.status === "error"
      ? "bg-rose-400"
      : "bg-emerald-400";
  const hasBody = !!(tool.input || tool.output);
  const dur = fmtDuration(tool.durationMs);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-hairline)]/70 bg-[var(--bg-raised)]/30 text-[12px]">
      <button
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
          hasBody ? "transition-colors hover:bg-[var(--bg-raised)]/60" : "cursor-default"
        }`}
      >
        <Icon
          name="ph:caret-right-bold"
          width="0.7rem"
          height="0.7rem"
          className={`text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""} ${
            hasBody ? "" : "opacity-30"
          }`}
        />
        <Icon name="ph:wrench-bold" width="0.85rem" height="0.85rem" className="text-purple-300" />
        <span className="font-mono text-[var(--text-primary)]">{tool.name}</span>
        <span className={`ml-auto h-1.5 w-1.5 rounded-full ${statusDot}`} />
        {dur && tool.status !== "running" ? (
          <span className="font-mono text-[var(--text-muted)]">{dur}</span>
        ) : null}
      </button>
      {open && hasBody ? (
        <div className="space-y-2 border-t border-[var(--border-hairline)]/70 px-3 py-2 font-mono text-[12px] leading-relaxed">
          {tool.input ? (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">input</div>
              <pre className="whitespace-pre-wrap text-[var(--text-secondary)]">{tool.input}</pre>
            </div>
          ) : null}
          {tool.output ? (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">output</div>
              <pre className="whitespace-pre-wrap text-[var(--text-secondary)]">{tool.output}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
