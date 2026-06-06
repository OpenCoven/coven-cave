"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { RichText } from "@/components/rich-text";
import { MessageBubble, SyntaxBlock } from "@/components/message-bubble";
import { canonicalize, formatHelp, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { parseGlyphString, DEFAULT_FAMILIAR_GLYPH } from "@/lib/familiar-glyph";
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  stripPreviewOnlyAttachmentFields,
  type ChatAttachment,
} from "@/lib/chat-attachments";

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
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ToolEvent[];
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  durationMs?: number;
};

type Props = {
  familiar: Familiar;
  familiars?: Familiar[];
  sessionId: string | null;
  projectRoot?: string;
  daemonRunning?: boolean;
  onSessionStarted?: (sessionId: string) => void;
  onBack?: () => void;
  onSlashCommand?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  onFamiliarSelect?: (id: string) => void;
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

type ComposerAttachment = ChatAttachment & { id: string };

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

function fmtBytes(size?: number): string {
  if (size == null) return "unknown";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${size} B`;
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (/\/(json|xml|yaml|toml|javascript|typescript|x-sh|csv)$/i.test(file.type)) return true;
  return /\.(txt|md|markdown|json|yaml|yml|toml|csv|ts|tsx|js|jsx|css|scss|html|xml|rs|go|py|rb|swift|java|kt|sh|zsh|fish|sql|log)$/i.test(file.name);
}

async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  const attachment: ComposerAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || undefined,
    mimeType: file.type || undefined,
    size: file.size,
  };
  if (isTextLike(file)) {
    const text = await file.slice(0, MAX_ATTACHMENT_TEXT_CHARS).text();
    attachment.text = text;
    if (file.size > new Blob([text]).size) attachment.truncated = true;
  } else if (file.type.startsWith("image/")) {
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") attachment.dataUrl = reader.result;
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  }
  return attachment;
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

// ── ChatEmptyState ────────────────────────────────────────────────────────────
// Shown when a chat session has no turns yet. Gives the user clear affordance
// to start a conversation rather than staring at a blank pane.

const STARTER_PROMPTS = [
  "What are you working on?",
  "Summarise recent work",
  "Help me plan something",
  "Run a quick task",
];

function ChatEmptyState({
  familiar,
  modKey,
  onPrompt,
}: {
  familiar: Familiar;
  modKey: string;
  onPrompt?: (text: string) => void;
}) {
  const glyph = parseGlyphString(familiar.icon) ?? parseGlyphString(familiar.emoji) ?? DEFAULT_FAMILIAR_GLYPH;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 select-none">
      {/* Avatar ring */}
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "var(--accent-presence)",
        }}
        aria-hidden
      >
        <FamiliarGlyph glyph={glyph} size="lg" className="inline-flex items-center justify-center" />
      </div>

      {/* Name + tagline */}
      <h2 className="mb-1 text-base font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
        {familiar.display_name}
      </h2>
      <p className="mb-6 text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
        Runs on{" "}
        <code
          className="rounded px-1 py-0.5 font-mono text-[11px]"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
        >
          {familiar.harness}
        </code>
        {" "}· type{" "}
        <kbd
          className="rounded px-1 py-0.5 font-mono text-[11px]"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
        >
          /
        </kbd>
        {" "}for commands
      </p>

      {/* Starter prompt chips */}
      {onPrompt && (
        <div className="flex flex-wrap justify-center gap-2">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPrompt(p)}
              className="rounded-full px-3 py-1.5 text-[12px] transition-colors"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "rgba(255,255,255,0.5)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.75)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)";
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Keyboard hint */}
      <p className="mt-8 text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
        {modKey}↵ to send
      </p>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { familiar, familiars = [], sessionId, projectRoot, onSessionStarted, onSlashCommand, onOpenOnboarding, onFamiliarSelect },
  ref,
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSessionRef = useRef<string | null>(sessionId);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Load history on attach; new chats open with a clean empty state
  useEffect(() => {
    currentSessionRef.current = sessionId;
    if (!sessionId) {
      setTurns([]);
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
                (t: { id: string; role: "user" | "assistant"; text: string; attachments?: ChatAttachment[]; durationMs?: number; createdAt?: string }) => ({
                  id: t.id,
                  role: t.role,
                  text: t.text,
                  attachments: t.attachments,
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
    if (atBottom) tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, atBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 80;
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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

  const sendRaw = async (text: string, outgoingAttachments: ChatAttachment[] = []) => {
    const trimmed = text.trim();
    if ((!trimmed && outgoingAttachments.length === 0) || busy) return;
    setBusy(true);
    setError(null);

    const now = new Date().toISOString();
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      ...(outgoingAttachments.length ? { attachments: outgoingAttachments } : {}),
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
          prompt: trimmed,
          ...(outgoingAttachments.length ? { attachments: stripPreviewOnlyAttachmentFields(outgoingAttachments) } : {}),
          sessionId: currentSessionRef.current,
          ...(projectRoot && !currentSessionRef.current ? { projectRoot } : {}),
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
    if (!text && attachments.length === 0) return;
    if (attachments.length === 0 && intentFromSlash(text)) return;
    const outgoingAttachments = attachments.map(({ id: _id, ...attachment }) => attachment);
    setInput("");
    setAttachments([]);
    await sendRaw(text, outgoingAttachments);
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 10 - attachments.length));
    if (selected.length === 0) return;
    const next = await Promise.all(selected.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    inputRef.current?.focus();
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
      {/* Chat header — familiar switcher + back */}
      <header className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
        <FamiliarSwitcher familiar={familiar} familiars={familiars} onSelect={onFamiliarSelect} />
        <div className="ml-auto flex items-center gap-2">
          <span className={[
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            "bg-[var(--bg-raised)]/60 text-[var(--text-muted)]",
          ].join(" ")}>
            <span className="font-mono">{familiar.harness ?? "—"}</span>
          </span>
        </div>
      </header>
      {/* Transcript */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          {turns.length === 0 ? (
            <ChatEmptyState familiar={familiar} modKey={keys.mod} />
          ) : null}
          {turns.map((t, i) => {
            const prev = turns[i - 1];
            const showTimestamp = (() => {
              if (!t.createdAt) return false;
              if (!prev?.createdAt) return true;
              const gap = new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime();
              if (!Number.isFinite(gap)) return true;
              if (gap >= 10 * 60 * 1000) return true;
              // Only suppress timestamps for consecutive same-role turns within 10 minutes.
              return prev.role !== t.role;
            })();
            return (
              <TurnRow key={t.id} turn={t} familiar={familiar} showTimestamp={showTimestamp} />
            );
          })}
          <div ref={tailRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              setAtBottom(true);
              tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }}
            aria-label="Scroll to bottom"
            className="sticky bottom-4 float-right z-20 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--accent-presence)]/40 bg-[var(--bg-raised)] text-[var(--accent-presence)] shadow-[0_2px_12px_var(--accent-presence)/20] transition-all hover:border-[var(--accent-presence)]/70 hover:bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-raised))] hover:shadow-[0_2px_18px_var(--accent-presence)/35]"
          >
            <Icon name="ph:caret-down-bold" width={12} />
          </button>
        )}
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
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-hairline)]/70 px-3 py-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-56 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/50 px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Icon name="ph:paperclip" width={12} />
                    <span className="truncate">{attachment.name}</span>
                    <span className="shrink-0 text-[var(--text-muted)]">{fmtBytes(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                      className="grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                      title={`Remove ${attachment.name}`}
                    >
                      <Icon name="ph:x-bold" width={9} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={busy ? "Streaming… (esc to cancel)" : `Message ${familiar.display_name}…`}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1 text-[var(--text-muted)]">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void attachFiles(e.currentTarget.files)}
                />
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]"
                  title="Attach files"
                  disabled={busy || attachments.length >= 10}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="ph:paperclip" width={14} />
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
                    className="grid h-7 w-7 place-items-center rounded-md bg-rose-500/90 text-white transition-colors hover:bg-rose-500"
                    title="Cancel (esc)"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!input.trim() && attachments.length === 0}
                    className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent-presence)] text-white transition-colors hover:bg-[var(--accent-presence-soft)] disabled:opacity-40"
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

// ── ThinkingIndicator ───────────────────────────────────────────────────────────
// Shown when a familiar is pending but has emitted no text yet.
// Renders three animated dots + elapsed wall-clock seconds.

function ThinkingIndicator({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(since).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since]);

  return (
    <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
      {/* Animated dots */}
      <span className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full animate-bounce"
            style={{
              background: "rgba(255,255,255,0.35)",
              animationDelay: `${i * 150}ms`,
              animationDuration: "900ms",
            }}
          />
        ))}
      </span>
      <span className="text-[11px] tabular-nums" style={{ color: "rgba(255,255,255,0.2)" }}>
        {elapsed}s
      </span>
    </div>
  );
}

// ── TurnRow ────────────────────────────────────────────────────────────────────

function TurnRow({ turn, familiar, showTimestamp = true }: { turn: Turn; familiar: Familiar; showTimestamp?: boolean }) {
  if (turn.role === "system" || turn.role === "user") {
    return (
      <div>
        <MessageBubble
          role={turn.role}
          content={turn.text || (turn.attachments?.length ? "Attached files" : "")}
          timestamp={turn.createdAt}
          showTimestamp={showTimestamp}
          pending={turn.pending}
        />
        {turn.attachments?.length ? <AttachmentList attachments={turn.attachments} /> : null}
      </div>
    );
  }
  // Assistant — preserve tool blocks + reasoning collapsible above the bubble
  const duration = fmtDuration(turn.durationMs);
  const { visible, reasoning } = splitReasoning(turn.text);
  const tools = turn.tools ?? [];
  const glyph = parseGlyphString(familiar.icon) ?? parseGlyphString(familiar.emoji) ?? DEFAULT_FAMILIAR_GLYPH;

  return (
    <div className="cave-turn-assistant">
      {/* Avatar column */}
      <div className="cave-turn-avatar" aria-hidden>
        <div className="cave-turn-avatar-ring">
          <FamiliarGlyph glyph={glyph} size="sm" />
        </div>
      </div>

      {/* Content column */}
      <div className="cave-turn-content text-[14px] leading-relaxed text-[var(--text-primary)] group/turn">
        {tools.length > 0 ? <ToolGroup tools={tools} /> : null}
        {reasoning ? <ReasoningBlock text={reasoning} /> : null}
        {turn.pending && !visible ? (
          <ThinkingIndicator since={turn.createdAt} />
        ) : (
          <MessageBubble
            role="assistant"
            content={visible || (turn.pending ? "…" : "")}
            timestamp={turn.createdAt}
            showTimestamp={showTimestamp}
            pending={turn.pending}
            isError={turn.error}
          />
        )}
        {duration && !turn.pending ? (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover/turn:opacity-100">
            <span>·</span>
            <span>worked for {duration}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentLightbox({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const isImage = (attachment.mimeType ?? attachment.type)?.startsWith("image/");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${attachment.name}`}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-xl border border-[var(--border-hairline)] bg-[#050409] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/60 px-4 py-2.5">
          <Icon name="ph:paperclip" width={13} className="shrink-0 text-[var(--text-muted)]" />
          <span className="flex-1 truncate text-[12px] text-[var(--text-secondary)]">{attachment.name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{fmtBytes(attachment.size)}</span>
          {attachment.truncated ? (
            <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">truncated</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <Icon name="ph:x-bold" width={11} />
          </button>
        </div>
        {/* Body */}
        {isImage && attachment.dataUrl ? (
          <div className="flex items-center justify-center p-4">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-h-[75vh] max-w-[85vw] rounded-lg object-contain"
            />
          </div>
        ) : attachment.text ? (
          <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
            {attachment.text}
          </pre>
        ) : (
          <div className="flex flex-col items-center gap-3 px-8 py-10 text-[var(--text-muted)]">
            <Icon name="ph:file-code" width={32} />
            <span className="text-[13px]">No preview available</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  const [selected, setSelected] = useState<ChatAttachment | null>(null);
  return (
    <>
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {attachments.map((attachment, index) => (
          <button
            type="button"
            key={`${attachment.name}-${index}`}
            className="inline-flex max-w-72 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-presence)]/40 hover:bg-[var(--bg-raised)]/70"
            title={`View ${attachment.name}`}
            onClick={() => setSelected(attachment)}
          >
            <Icon name="ph:paperclip" width={12} className="shrink-0 text-[var(--text-muted)]" />
            <span className="truncate">{attachment.name}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{fmtBytes(attachment.size)}</span>
            {attachment.truncated ? (
              <span className="shrink-0 text-[var(--text-muted)]">truncated</span>
            ) : null}
          </button>
        ))}
      </div>
      {selected ? (
        <AttachmentLightbox attachment={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n").filter((l) => l.trim());
  const preview = lines[0] ? lines[0].slice(0, 72) + (lines[0].length > 72 ? "…" : "") : "";
  return (
    <div className="mb-2 overflow-hidden rounded-md border border-[var(--border-hairline)]/60 bg-[var(--bg-raised)]/20 text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--bg-raised)]/50"
      >
        <Icon name="ph:brain" width="0.8rem" height="0.8rem" className="shrink-0 text-[var(--text-muted)]/70" />
        <span className="text-[11px] text-[var(--text-muted)]">reasoning</span>
        {!open && preview ? (
          <span className="flex-1 truncate font-mono text-[11px] italic text-[var(--text-muted)]/60">{preview}</span>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]/50">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        )}
        <Icon
          name="ph:caret-right-bold"
          width="0.65rem"
          height="0.65rem"
          className={`shrink-0 text-[var(--text-muted)]/50 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)]/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
          {text}
        </div>
      ) : null}
    </div>
  );
}

// ── ToolGroup ──────────────────────────────────────────────────────────────────
// When a turn has 3+ tool calls, collapse them under a summary row.
// 1-2 tools always show expanded (they don't clutter).

// All tool groups are collapsed by default — expand on demand.
// Running tools auto-open so the user sees live progress.
function ToolGroup({ tools }: { tools: ToolEvent[] }) {
  const anyRunning = tools.some((t) => t.status === "running");
  const anyError   = tools.some((t) => t.status === "error");
  const [open, setOpen] = useState(anyRunning);
  const [manuallyToggled, setManuallyToggled] = useState(false);

  // Auto-open while running; auto-close when all settle (unless user manually toggled)
  const prevRunning = useRef(anyRunning);
  useEffect(() => {
    if (anyRunning && !prevRunning.current) {
      setOpen(true);
      setManuallyToggled(false);
    }
    if (!anyRunning && prevRunning.current && !manuallyToggled) {
      setOpen(false);
    }
    prevRunning.current = anyRunning;
  }, [anyRunning, manuallyToggled]);

  const doneCount = tools.filter((t) => t.status === "ok").length;
  const errCount  = tools.filter((t) => t.status === "error").length;

  const statusDot = anyError
    ? "bg-rose-400"
    : anyRunning
    ? "bg-amber-400 animate-pulse"
    : "bg-emerald-400/70";

  const label = anyRunning
    ? `${tools.length} tool call${tools.length > 1 ? "s" : ""} · running`
    : errCount > 0
    ? `${tools.length} tool call${tools.length > 1 ? "s" : ""} · ${errCount} error${errCount > 1 ? "s" : ""}`
    : tools.length === 1
    ? tools[0].name
    : `${tools.length} tool calls · done`;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-[var(--border-hairline)]/60 bg-[var(--bg-raised)]/20 text-[12px]">
      <button
        type="button"
        onClick={() => { setManuallyToggled(true); setOpen((v) => !v); }}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--bg-raised)]/50"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
        <Icon name="ph:wrench" width="0.8rem" height="0.8rem" className="shrink-0 text-[var(--text-muted)]/70" />
        <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{label}</span>
        <Icon
          name="ph:caret-right-bold"
          width="0.65rem"
          height="0.65rem"
          className={`shrink-0 text-[var(--text-muted)]/50 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-[var(--border-hairline)]/60 p-1.5">
          {tools.map((t) => <ToolBlock key={t.id} tool={t} />)}
        </div>
      ) : null}
    </div>
  );
}

// ── ToolBlock ──────────────────────────────────────────────────────────────────

/** Lines above this threshold get a max-height + fade + expand toggle */
const TOOL_BODY_COLLAPSE_LINES = 12;

function ToolBodySection({ label, text }: { label: string; text: string }) {
  const lineCount = text.split("\n").length;
  const isLong = lineCount > TOOL_BODY_COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="relative">
        <div
          style={isLong && !expanded
            ? { maxHeight: "12rem", overflow: "hidden" }
            : undefined}
        >
          <SyntaxBlock text={text} />
        </div>
        {isLong && !expanded && (
          <div
            className="absolute inset-x-0 bottom-0 flex items-end justify-center"
            style={{ height: "3.5rem", background: "linear-gradient(to bottom, transparent, var(--bg-raised, #1a1a1a) 85%)" }}
          >
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mb-1 rounded border border-[var(--border-hairline)]/70 px-2.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-primary)]"
            >
              Show {lineCount - TOOL_BODY_COLLAPSE_LINES} more lines
            </button>
          </div>
        )}
        {isLong && expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
          >
            ↑ collapse
          </button>
        )}
      </div>
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
          {tool.input ? <ToolBodySection label="input" text={tool.input} /> : null}
          {tool.output ? <ToolBodySection label="output" text={tool.output} /> : null}
        </div>
      ) : null}
    </div>
  );
}
