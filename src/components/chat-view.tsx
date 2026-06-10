"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { MessageBubble, SyntaxBlock } from "@/components/message-bubble";
import { canonicalize, formatHelp, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { slashSaveParse } from "@/lib/slash-save-parser";
import { Icon, type IconName } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { useVisualViewport } from "@/lib/use-viewport";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import type { ChatLinkedContext } from "@/lib/chat-linked-context";
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  stripPreviewOnlyAttachmentFields,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { VoiceCallButton } from "./voice-call-button";
import { VoiceCallOverlay } from "./voice-call-overlay";
import { CsvImportModal } from "./csv-import-modal";
import { looksLikeCsv } from "@/lib/csv-import";

type ToolEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
};

type ChatTurnLifecycle =
  | "queued"
  | "connecting"
  | "streaming"
  | "tooling"
  | "cancelled"
  | "failed"
  | "complete";

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
  lifecycle?: ChatTurnLifecycle;
  durationMs?: number;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

type Props = {
  familiar: Familiar;
  sessionId: string | null;
  session?: SessionRow | null;
  projectRoot?: string;
  daemonRunning?: boolean;
  onSessionStarted?: (sessionId: string) => void;
  onSessionsChanged?: () => void;
  onBack?: () => void;
  onSlashCommand?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  /** Reverse navigation for a chat that's linked to a board task — clicking
   *  the Task chip in the context strip routes back to the board with the
   *  card focused. The link is bidirectional; this is the chat→task side. */
  onOpenTask?: (cardId: string) => void;
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
type ChatHistoryState = "idle" | "loading" | "loaded" | "missing" | "error";
type FailedSend = {
  text: string;
  attachments: ChatAttachment[];
};

function fmtDuration(ms?: number): string | null {
  if (!ms || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function lifecycleLabel(lifecycle: ChatTurnLifecycle): string {
  switch (lifecycle) {
    case "queued":
      return "Queued";
    case "connecting":
      return "Connecting";
    case "streaming":
      return "Writing";
    case "tooling":
      return "Using tools";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "complete":
      return "Complete";
  }
}

function lifecycleDetail(lifecycle: ChatTurnLifecycle, familiarName: string): string {
  switch (lifecycle) {
    case "queued":
      return `Queued for ${familiarName}`;
    case "connecting":
      return `Contacting ${familiarName}`;
    case "streaming":
      return `${familiarName} is writing`;
    case "tooling":
      return `${familiarName} is using tools`;
    case "cancelled":
      return "Response cancelled";
    case "failed":
      return "Response failed";
    case "complete":
      return "Response complete";
  }
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function repoName(p?: string | null): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function githubLabel(kind: string): string {
  if (kind === "pr") return "PR";
  if (kind === "issue") return "Issue";
  if (kind === "review_request") return "Review";
  if (kind === "discussion") return "Discussion";
  return "GitHub";
}

function githubIcon(kind: string): IconName {
  if (kind === "issue") return "ph:bug-bold";
  if (kind === "discussion") return "ph:chats";
  if (kind === "review_request") return "ph:check-circle";
  if (kind === "notification") return "ph:bell";
  if (kind === "repo") return "ph:git-fork-bold";
  return "ph:git-pull-request";
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
 * Unclosed reasoning blocks are captured while streaming instead of leaking
 * raw internal tags into the transcript.
 */
function splitReasoning(text: string): { visible: string; reasoning: string } {
  const reasoningParts: string[] = [];
  const visibleParts: string[] = [];
  const tagRe = /<(\/?)(thinking|reasoning)>/gi;
  let activeTag: string | null = null;
  let reasoningStart = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(text)) !== null) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (!activeTag && closing) {
      visibleParts.push(text.slice(cursor, match.index));
      cursor = tagRe.lastIndex;
      continue;
    }

    if (!activeTag && !closing) {
      visibleParts.push(text.slice(cursor, match.index));
      activeTag = tag;
      reasoningStart = tagRe.lastIndex;
      cursor = tagRe.lastIndex;
      continue;
    }

    if (activeTag === tag && closing) {
      reasoningParts.push(text.slice(reasoningStart, match.index).trim());
      activeTag = null;
      cursor = tagRe.lastIndex;
    }
  }

  if (activeTag) {
    reasoningParts.push(text.slice(reasoningStart).trim());
  } else {
    visibleParts.push(text.slice(cursor));
  }

  const visible = visibleParts.join("");
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

  return (
    <div className="cave-chat-empty select-none">
      <div className="cave-chat-empty-mark">
        <Icon name="ph:sparkle-bold" width={18} aria-hidden />
      </div>
      <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">
        {familiar.display_name}
      </h2>
      <p className="mb-6 text-[13px] text-[var(--text-muted)]">
        Runs on{" "}
        <code className="rounded px-1 py-0.5 font-mono text-[11px] bg-[var(--bg-raised)] text-[var(--text-secondary)]">
          {familiar.harness}
        </code>
        {" "}· type{" "}
        <kbd className="rounded px-1 py-0.5 font-mono text-[11px] bg-[var(--bg-raised)] text-[var(--text-secondary)]">
          /
        </kbd>
        {" "}for commands
      </p>

      {onPrompt && (
        <div className="flex flex-wrap justify-center gap-2">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPrompt(p)}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/55 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Keyboard-shortcut hint is desktop-only; touch devices have no Cmd
       * key and on-screen keyboards send via a separate button. */}
      <p className="cave-chat-empty-hint mt-8 text-[11px] text-[var(--text-muted)]">
        {modKey}↵ to send
      </p>
    </div>
  );
}

function ChatHistoryNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-5 py-6 text-center">
      <Icon name="ph:chats" width={18} className="mb-2 text-[var(--text-muted)]" />
      <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

function ChatLifecycleStatus({
  busy,
  lifecycle,
  familiarName,
}: {
  busy: boolean;
  lifecycle: ChatTurnLifecycle | null;
  familiarName: string;
}) {
  if (!busy && !lifecycle) return null;
  const phase = lifecycle ?? "connecting";
  return (
    <div
      className={`cave-chat-lifecycle-status cave-chat-lifecycle-status--${phase}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-lifecycle={phase}
    >
      <span className="cave-chat-lifecycle-dot" aria-hidden />
      <span className="min-w-0 truncate">{lifecycleDetail(phase, familiarName)}</span>
      {busy ? <span className="shrink-0 text-[var(--text-muted)]">Esc cancels</span> : null}
    </div>
  );
}

function ChatTitleEditable({
  session,
  displayTitleOverride,
  onSessionsChanged,
  headline = false,
}: {
  session: SessionRow;
  /** When set, displayed in place of session.title (e.g. to hide a raw
   *  "Task context: …" seed prompt that leaked through as the title). The
   *  edit input still pre-fills with the override so accepting it patches
   *  the canonical title in the daemon/state. */
  displayTitleOverride?: string | null;
  onSessionsChanged?: () => void;
  /** Render as a full-width all-caps headline row above the context chips
   *  instead of an inline title inside the session chip. */
  headline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const baseTitle = displayTitleOverride ?? session.title ?? "";
  const [value, setValue] = useState(baseTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!editing) setValue(baseTitle);
  }, [baseTitle, editing]);

  useEffect(() => {
    if (!editing) return;
    submittedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const display = baseTitle || session.id;

  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === (session.title ?? "").trim()) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      onSessionsChanged?.();
    } catch {
      /* transient — next sessions poll will reconcile */
    }
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setValue(baseTitle);
    setEditing(false);
  };

  const inputClassName = headline
    ? "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[13px] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] outline-none"
    : "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[14px] font-semibold leading-tight text-[var(--text-primary)] outline-none";

  const buttonClassName = headline
    ? "block w-full truncate text-left text-[13px] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]"
    : "min-w-0 flex-1 truncate text-left text-[14px] font-semibold leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]";

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={inputClassName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void submit()}
        aria-label="Chat title"
        maxLength={200}
      />
    );
  }

  return (
    <button
      type="button"
      className={buttonClassName}
      title={`${display} — click to rename`}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {display}
    </button>
  );
}

function ChatContextStrip({
  session,
  linkedContext,
  historyState,
  onSessionsChanged,
  onOpenTask,
}: {
  session: SessionRow | null;
  linkedContext: ChatLinkedContext | null;
  historyState: ChatHistoryState;
  onSessionsChanged?: () => void;
  onOpenTask?: (cardId: string) => void;
}) {
  const task = linkedContext?.task ?? null;
  const github = linkedContext?.github ?? [];
  if (!session && !task && github.length === 0 && historyState === "idle") return null;

  return (
    <div className="cave-chat-linear-header-context">
      {session ? (
        <span className="inline-flex min-w-0 items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
          <Icon name="ph:chats-circle" width={14} className="shrink-0 text-[var(--text-muted)]" />
          {session.project_root ? (
            <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{repoName(session.project_root)}</span>
          ) : (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">chat</span>
          )}
        </span>
      ) : session === null && historyState !== "idle" ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2 py-1 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:clock" width={12} />
          {historyState}
        </span>
      ) : null}
      {task ? (
        onOpenTask ? (
          <button
            type="button"
            onClick={() => onOpenTask(task.id)}
            title={`Open task: ${task.title}`}
            className="focus-ring inline-flex min-w-0 max-w-[24rem] items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_18%,transparent)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
            <span className="shrink-0 font-medium">Task</span>
            <span className="min-w-0 truncate">{task.title}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{task.status}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{task.priority}</span>
            <Icon name="ph:arrow-square-out" width={10} className="shrink-0 text-[var(--text-muted)]" />
          </button>
        ) : (
          <span className="inline-flex min-w-0 max-w-[24rem] items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
            <span className="shrink-0 font-medium">Task</span>
            <span className="min-w-0 truncate">{task.title}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{task.status}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{task.priority}</span>
          </span>
        )
      ) : null}
      {github.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={`Open on GitHub: ${item.title}`}
          className="inline-flex min-w-0 max-w-[18rem] items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          <Icon name={githubIcon(item.kind)} width={12} className="shrink-0 text-[var(--text-muted)]" />
          <span className="shrink-0">{githubLabel(item.kind)}</span>
          <span className="min-w-0 truncate">{item.repo}{item.number ? ` #${item.number}` : ""}</span>
          {item.state ? <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span> : null}
        </a>
      ))}
    </div>
  );
}

function MobileChatContextMenu({
  familiar,
  session,
  linkedContext,
  historyState,
  daemonRunning,
  projectRoot,
  onOpenTask,
}: {
  familiar: Familiar;
  session: SessionRow | null;
  linkedContext: ChatLinkedContext | null;
  historyState: ChatHistoryState;
  daemonRunning?: boolean;
  projectRoot?: string;
  onOpenTask?: (cardId: string) => void;
}) {
  const task = linkedContext?.task ?? null;
  const github = linkedContext?.github ?? [];
  const repo = repoName(session?.project_root ?? projectRoot);
  const runtime = [
    familiar.harness,
    familiar.model,
    repo,
  ].filter(Boolean).join(" · ");

  return (
    <details className="cave-mobile-context">
      <summary className="cave-mobile-context-trigger" aria-label="Open chat context">
        <Icon name="ph:dots-three-vertical" width={17} aria-hidden />
      </summary>
      <div className="cave-mobile-context-panel">
        <div className="cave-mobile-context-card">
          <div className="cave-mobile-context-kicker">Familiar</div>
          <div className="cave-mobile-context-title">{familiar.display_name}</div>
          <div className="cave-mobile-context-copy">{runtime || familiar.role}</div>
        </div>
        <div className="cave-mobile-context-grid">
          <span className="cave-mobile-context-chip">
            <Icon name={daemonRunning === false ? "ph:warning-circle" : "ph:check-circle"} width={13} aria-hidden />
            {daemonRunning === false ? "Daemon offline" : "Daemon ready"}
          </span>
          <span className="cave-mobile-context-chip">
            <Icon name="ph:clock" width={13} aria-hidden />
            {session?.status ?? historyState}
          </span>
        </div>
        {task ? (
          onOpenTask ? (
            <button
              type="button"
              className="cave-mobile-context-link"
              onClick={() => onOpenTask(task.id)}
            >
              <Icon name="ph:kanban" width={13} aria-hidden />
              <span className="min-w-0 flex-1 truncate">Task: {task.title}</span>
              <Icon name="ph:arrow-square-out" width={12} aria-hidden />
            </button>
          ) : (
            <span className="cave-mobile-context-link">
              <Icon name="ph:kanban" width={13} aria-hidden />
              <span className="min-w-0 flex-1 truncate">Task: {task.title}</span>
            </span>
          )
        ) : null}
        {github.length ? (
          <div className="cave-mobile-context-links">
            {github.slice(0, 3).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="cave-mobile-context-link"
              >
                <Icon name={githubIcon(item.kind)} width={13} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{githubLabel(item.kind)} · {item.repo}{item.number ? ` #${item.number}` : ""}</span>
                <Icon name="ph:arrow-square-out" width={12} aria-hidden />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** Headline row: full-width chat title, flush-left, all-caps. Sits above
 *  the existing identity/chips row. Computes the same defense-in-depth
 *  override as ChatContextStrip — see comment there for why. */
function ChatHeadlineTitle({
  session,
  linkedContext,
  onSessionsChanged,
}: {
  session: SessionRow | null;
  linkedContext: ChatLinkedContext | null;
  onSessionsChanged?: () => void;
}) {
  if (!session) return null;
  const task = linkedContext?.task ?? null;
  const sessionTitleOverride =
    task && (session.title ?? "").startsWith("Task context:")
      ? `Task: ${task.title}`
      : null;
  return (
    <ChatTitleEditable
      session={session}
      displayTitleOverride={sessionTitleOverride}
      onSessionsChanged={onSessionsChanged}
      headline
    />
  );
}

function MobileChatActionStrip({
  busy,
  canRetry,
  canAttach,
  hasSession,
  onRetry,
  onStop,
  onSummarize,
  onAttach,
  onVoice,
}: {
  busy: boolean;
  canRetry: boolean;
  canAttach: boolean;
  hasSession: boolean;
  onRetry: () => void;
  onStop: () => void;
  onSummarize: () => void;
  onAttach: () => void;
  onVoice: () => void;
}) {
  return (
    <div className="cave-mobile-action-strip" aria-label="Chat actions">
      <button type="button" onClick={onRetry} disabled={!canRetry || busy} className="cave-mobile-action-chip">
        <Icon name="ph:arrow-clockwise" width={13} aria-hidden />
        Retry
      </button>
      <button type="button" onClick={onStop} disabled={!busy} className="cave-mobile-action-chip">
        <Icon name="ph:x-bold" width={13} aria-hidden />
        Stop
      </button>
      <button type="button" onClick={onSummarize} disabled={busy} className="cave-mobile-action-chip">
        <Icon name="ph:magnifying-glass" width={13} aria-hidden />
        Summarize
      </button>
      <button type="button" onClick={onAttach} disabled={!canAttach || busy} className="cave-mobile-action-chip">
        <Icon name="ph:paperclip" width={13} aria-hidden />
        Attach
      </button>
      <button type="button" onClick={onVoice} disabled={!hasSession} className="cave-mobile-action-chip cave-mobile-action-chip--icon" aria-label="Start voice call">
        <Icon name="ph:phone" width={13} aria-hidden />
      </button>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { familiar, sessionId, session, projectRoot, daemonRunning, onSessionStarted, onSessionsChanged, onSlashCommand, onOpenOnboarding, onOpenTask },
  ref,
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyState, setHistoryState] = useState<ChatHistoryState>("idle");
  const [linkedContext, setLinkedContext] = useState<ChatLinkedContext | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedSend, setLastFailedSend] = useState<FailedSend | null>(null);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [csvRaw, setCsvRaw] = useState<string | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const currentSessionRef = useRef<string | null>(sessionId);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const keys = useKeySymbols();

  // Track the iOS visual viewport so the composer dock can translate up
  // by the on-screen keyboard height. `100dvh` shrinks the layout for
  // most browsers; iOS Safari is the laggard where position:sticky alone
  // leaves the dock under the keyboard until the next layout pass.
  // Keyboard height ≈ window.innerHeight - visualViewport.height; on
  // desktop both are equal so the offset stays 0.
  const vv = useVisualViewport();
  const keyboardOffset =
    typeof window !== "undefined" && vv.height > 0
      ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      : 0;

  // Slash suggestions
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = input.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || input.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [input]);
  const [slashIdx, setSlashIdx] = useState(0);
  const activeLifecycle = useMemo(() => {
    const activeTurn = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.pending);
    return activeTurn?.lifecycle ?? (busy ? "connecting" : null);
  }, [busy, turns]);

  useEffect(() => {
    setSlashIdx(0);
  }, [input]);

  // Load history on attach; new chats open with a clean empty state
  useEffect(() => {
    currentSessionRef.current = sessionId;
    setLinkedContext(null);
    if (!sessionId) {
      setTurns([]);
      setHistoryState("idle");
      return;
    }
    let cancelled = false;
    void (async () => {
      setHistoryState("loading");
      try {
        const res = await fetch(`/api/chat/conversation/${sessionId}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setTurns([]);
            setHistoryState(res.status === 404 ? "missing" : "error");
          }
          return;
        }
        const json = await res.json() as {
          ok?: boolean;
          context?: ChatLinkedContext | null;
          conversation?: {
            turns?: Array<{
              id: string;
              role: string;
              text: string;
              attachments?: ChatAttachment[];
              reasoning?: string;
              tools?: ToolEvent[];
              durationMs?: number;
              isError?: boolean;
              createdAt?: string;
              origin?: "chat" | "voice";
              voiceCallId?: string;
            }>;
          };
        };
        if (cancelled) return;
        setLinkedContext(json.context ?? null);
        if (json.ok && json.conversation) {
          setTurns(
            (json.conversation.turns ?? [])
              .filter(
                (t): t is {
                  id: string;
                  role: "user" | "assistant";
                  text: string;
                  attachments?: ChatAttachment[];
                  reasoning?: string;
                  tools?: ToolEvent[];
                  durationMs?: number;
                  isError?: boolean;
                  createdAt?: string;
                  origin?: "chat" | "voice";
                  voiceCallId?: string;
                } => t.role === "user" || t.role === "assistant",
              )
              .map((t) => ({
                  id: t.id,
                  role: t.role,
                  text: t.text,
                  attachments: t.attachments,
                  reasoning: t.reasoning,
                  tools: t.tools,
                  durationMs: t.durationMs,
                  error: t.isError,
                  createdAt: t.createdAt ?? new Date().toISOString(),
                  origin: t.origin,
                  voiceCallId: t.voiceCallId,
                })),
          );
          setHistoryState("loaded");
        } else if (json.ok && json.context) {
          // Known affiliation (e.g. fresh task chat) — no transcript yet.
          setTurns([]);
          setHistoryState("loaded");
        } else {
          setTurns([]);
          setHistoryState("missing");
        }
      } catch {
        if (!cancelled) {
          setTurns([]);
          setHistoryState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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

  function resizeComposer() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  useEffect(() => {
    resizeComposer();
  }, [input]);

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
    // /save, /bookmark, /read — route a URL into the library
    if (command === "/save" || command === "/bookmark" || command === "/read") {
      const parsed = slashSaveParse(args);
      if ("error" in parsed) {
        appendSystem("Usage: /save <url> [bookmarks|reading|github] [#tag]");
        setInput("");
        return true;
      }
      setInput("");
      void (async () => {
        try {
          const res = await fetch("/api/library/route-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url: parsed.url,
              source: { kind: "slash", originSessionId: currentSessionRef.current ?? null },
              familiar: familiar.id,
              tags: parsed.tags,
              listHint: parsed.listHint,
            }),
          });
          const json = await res.json() as { ok: boolean; deduped?: boolean; classify?: { rule: string } };
          if (!json.ok) {
            appendSystem("Save failed.");
          } else if (json.deduped) {
            appendSystem("Already in library.");
          } else {
            const list =
              json.classify?.rule === "github" ? "GitHub" :
              json.classify?.rule === "article-host" || json.classify?.rule === "paper-host" || json.classify?.rule === "video-host" ? "Reading" :
              "Bookmarks";
            appendSystem(`Saved to ${list}.`);
          }
        } catch {
          appendSystem("Save failed.");
        }
      })();
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
    const request: FailedSend = { text: trimmed, attachments: outgoingAttachments };
    setBusy(true);
    setError(null);
    setLastFailedSend(null);

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
      lifecycle: "queued",
      createdAt: now,
      tools: [],
    };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setAssistantLifecycle(assistantId, "connecting");
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
        setLastFailedSend(request);
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
            handleEvent(ev, assistantId, request);
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
              ? { ...t, pending: false, lifecycle: "cancelled", text: t.text || "(cancelled)" }
              : t,
          ),
        );
      } else {
        setError(err instanceof Error ? err.message : "send failed");
        setLastFailedSend(request);
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

  function retryLastSend() {
    if (!lastFailedSend || busy) return;
    setError(null);
    setLastFailedSend(null);
    void sendRaw(lastFailedSend.text, lastFailedSend.attachments);
  }

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
    // Check for CSV files before normal attachment handling
    if (files?.length) {
      const csvFiles = Array.from(files).filter((f) => f.name.endsWith(".csv") || f.type === "text/csv");
      if (csvFiles.length > 0 && csvFiles[0]) {
        const text = await csvFiles[0].text();
        if (looksLikeCsv(text)) { setCsvRaw(text); return; }
      }
    }
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 10 - attachments.length));
    if (selected.length === 0) return;
    const next = await Promise.all(selected.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    inputRef.current?.focus();
  };

  const handleEvent = (ev: StreamEvent, assistantId: string, request: FailedSend) => {
    switch (ev.kind) {
      case "session": {
        if (!currentSessionRef.current) {
          currentSessionRef.current = ev.sessionId;
          onSessionStarted?.(ev.sessionId);
        }
        return;
      }
      case "assistant_chunk": {
        setAssistantLifecycle(assistantId, "streaming");
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, text: (t.text + ev.text).replace(/\n{3,}/g, "\n\n"), pending: true, lifecycle: "streaming" }
              : t,
          ),
        );
        return;
      }
      case "tool_use": {
        setAssistantLifecycle(assistantId, "tooling");
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
            return { ...t, tools: nextTools, lifecycle: t.pending ? "tooling" : t.lifecycle };
          }),
        );
        return;
      }
      case "done": {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, pending: false, error: ev.isError ?? false, lifecycle: ev.isError ? "failed" : "complete", durationMs: ev.durationMs }
              : t,
          ),
        );
        if (ev.isError) setLastFailedSend(request);
        if (ev.sessionId && !currentSessionRef.current) {
          currentSessionRef.current = ev.sessionId;
          onSessionStarted?.(ev.sessionId);
        }
        return;
      }
      case "error": {
        setError(ev.message);
        setLastFailedSend(request);
        markAssistantError(assistantId);
        if (ev.code === "ENOENT") onOpenOnboarding?.();
        return;
      }
    }
  };

  const markAssistantError = (id: string) => {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pending: false, error: true, lifecycle: "failed" } : t)),
    );
  };

  function setAssistantLifecycle(id: string, lifecycle: ChatTurnLifecycle) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, lifecycle } : t)),
    );
  }

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
    <section className="cave-chat-linear flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="cave-chat-linear-header">
        <div className="cave-mobile-header-identity">
          <div className="cave-mobile-header-familiar">
            <FamiliarIcon familiar={familiar} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">{familiar.display_name}</div>
              <div className="truncate font-mono text-[10px] leading-tight text-[var(--text-muted)]">
                {familiar.harness ?? "cave"}
                {familiar.model ? ` · ${familiar.model}` : ""}
              </div>
            </div>
          </div>
          <span className={[
            "cave-mobile-daemon-pill",
            daemonRunning === false ? "cave-mobile-daemon-pill--offline" : "cave-mobile-daemon-pill--ready",
          ].join(" ")}>
            <span aria-hidden />
            {daemonRunning === false ? "offline" : "ready"}
          </span>
          <MobileChatContextMenu
            familiar={familiar}
            session={session ?? null}
            daemonRunning={daemonRunning}
            linkedContext={linkedContext}
            historyState={historyState}
            projectRoot={projectRoot}
            onOpenTask={onOpenTask}
          />
        </div>
        <ChatHeadlineTitle
          session={session ?? null}
          linkedContext={linkedContext}
          onSessionsChanged={onSessionsChanged}
        />
        {/* Single compact bar: status · meta · context strip (identity lives in the rail above) */}
        <div className="cave-chat-linear-header-row">
          <div className="cave-chat-linear-header-identity">
            <span className={[
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              daemonRunning === false
                ? "bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]"
                : "bg-[color-mix(in_oklch,var(--color-success)_16%,transparent)] text-[var(--color-success)]",
            ].join(" ")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {daemonRunning === false ? "offline" : "ready"}
            </span>
            <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)] font-mono">
              {familiar.harness ?? ""}
              {familiar.model ? <> · {familiar.model}</> : null}
              {(session?.project_root ?? projectRoot) ? <> · {repoName(session?.project_root ?? projectRoot)}</> : null}
            </span>
          </div>
          {sessionId && (
            <VoiceCallButton
              familiar={familiar}
              callActive={voiceCallOpen}
              onOpen={() => setVoiceCallOpen(true)}
            />
          )}
          <ChatContextStrip
            session={session ?? null}
            linkedContext={linkedContext}
            historyState={historyState}
            onSessionsChanged={onSessionsChanged}
            onOpenTask={onOpenTask}
          />
        </div>
      </header>
      <div ref={scrollRef} className="cave-chat-transcript relative min-h-0 flex-1 overflow-y-auto">
        <div
          className="cave-chat-thread"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Conversation"
        >
          {turns.length === 0 ? (
            historyState === "loading" ? (
              <ChatHistoryNotice title="Loading chat history" body="Restoring this session transcript..." />
            ) : historyState === "missing" ? (
              <ChatHistoryNotice title="Chat history unavailable" body="This session exists, but CovenCave could not find a saved transcript for it yet." />
            ) : historyState === "error" ? (
              <ChatHistoryNotice title="Could not load chat history" body="The transcript request failed. You can still continue this session." />
            ) : (
              <ChatEmptyState familiar={familiar} modKey={keys.mod} onPrompt={(text) => {
                setInput(text);
                inputRef.current?.focus();
              }} />
            )
          ) : null}
          {(() => {
            type VoiceGroup = { kind: "call"; callId: string; turns: Turn[]; durationSec: number };
            type SingleItem = { kind: "single"; turn: Turn };
            const grouped: Array<VoiceGroup | SingleItem> = [];
            for (const turn of turns) {
              if (turn.voiceCallId) {
                const last = grouped[grouped.length - 1];
                if (last && last.kind === "call" && last.callId === turn.voiceCallId) {
                  last.turns.push(turn);
                  const firstAt = Date.parse(last.turns[0].createdAt);
                  const lastAt = Date.parse(last.turns[last.turns.length - 1].createdAt);
                  last.durationSec = Math.max(0, Math.floor((lastAt - firstAt) / 1000));
                } else {
                  grouped.push({ kind: "call", callId: turn.voiceCallId, turns: [turn], durationSec: 0 });
                }
              } else {
                grouped.push({ kind: "single", turn });
              }
            }

            // Build a flat ordered list of turns for timestamp gap logic (prev-turn lookup).
            const allTurns = turns;

            return grouped.map((g) => {
              if (g.kind === "single") {
                const t = g.turn;
                const i = allTurns.indexOf(t);
                const prev = allTurns[i - 1];
                const showTimestamp = (() => {
                  if (!t.createdAt) return false;
                  if (!prev?.createdAt) return true;
                  const gap = new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime();
                  if (!Number.isFinite(gap)) return true;
                  if (gap >= 10 * 60 * 1000) return true;
                  return prev.role !== t.role;
                })();
                return (
                  <TurnRow key={t.id} turn={t} familiar={familiar} showTimestamp={showTimestamp} index={i} />
                );
              }
              const mm = String(Math.floor(g.durationSec / 60)).padStart(2, "0");
              const ss = String(g.durationSec % 60).padStart(2, "0");
              return (
                <div key={g.callId} className="cave-chat-voice-call-group">
                  <div className="cave-chat-voice-call-header">
                    <span aria-hidden>📞</span>
                    Voice call · {mm}:{ss}
                  </div>
                  {g.turns.map((t) => {
                    const i = allTurns.indexOf(t);
                    const prev = allTurns[i - 1];
                    const showTimestamp = (() => {
                      if (!t.createdAt) return false;
                      if (!prev?.createdAt) return true;
                      const gap = new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime();
                      if (!Number.isFinite(gap)) return true;
                      if (gap >= 10 * 60 * 1000) return true;
                      return prev.role !== t.role;
                    })();
                    return (
                      <TurnRow key={t.id} turn={t} familiar={familiar} showTimestamp={showTimestamp} index={i} />
                    );
                  })}
                </div>
              );
            });
          })()}
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
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_16%,transparent)] px-5 py-2 text-xs text-[var(--color-warning)]"
        >
          <span className="min-w-0 truncate">{error}</span>
          {lastFailedSend ? (
            <button
              type="button"
              onClick={retryLastSend}
              disabled={busy}
              className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_42%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium text-[var(--color-warning)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40"
            >
              <Icon name="ph:arrow-clockwise" width={12} aria-hidden />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <ChatLifecycleStatus
        busy={busy}
        lifecycle={activeLifecycle}
        familiarName={familiar.display_name}
      />

      <footer
        className="cave-composer-dock"
        style={{ "--composer-kb-offset": `${keyboardOffset}px` } as React.CSSProperties}
      >
        <div className="cave-composer-shell">
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

          <MobileChatActionStrip
            busy={busy}
            canRetry={Boolean(lastFailedSend)}
            canAttach={attachments.length < 10}
            hasSession={Boolean(sessionId)}
            onRetry={retryLastSend}
            onStop={cancelSend}
            onSummarize={() => {
              setInput((current) => current.trim() ? current : "Summarize this session and call out decisions, blockers, and next actions.");
              inputRef.current?.focus();
            }}
            onAttach={() => fileInputRef.current?.click()}
            onVoice={() => setVoiceCallOpen(true)}
          />

          <div className="cave-composer-panel">
            {csvRaw && !csvModalOpen && (
              <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/70 bg-[var(--bg-raised)] px-3 py-1.5">
                <Icon name="ph:file-text" width={12} className="shrink-0 text-[var(--text-muted)]" />
                <span className="flex-1 truncate text-[11px] text-[var(--text-secondary)]">CSV detected — import to Library?</span>
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(true)}
                  className="shrink-0 rounded bg-[var(--accent-presence)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90"
                >Import</button>
                <button
                  type="button"
                  onClick={() => setCsvRaw(null)}
                  className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label="Dismiss"
                ><Icon name="ph:x-bold" width={9} /></button>
              </div>
            )}
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
                      className="focus-ring grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                      title={`Remove ${attachment.name}`}
                      aria-label={`Remove ${attachment.name}`}
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
              onPaste={(e) => {
                const text = e.clipboardData.getData("text/plain");
                if (looksLikeCsv(text)) { setCsvRaw(text); }
              }}
              placeholder={busy ? "Streaming… (esc to cancel)" : `Message ${familiar.display_name}…  ↵ to send`}
              rows={1}
              inputMode="text"
              enterKeyHint="send"
              className="cave-composer-input w-full resize-none bg-transparent px-4 pt-3 pb-2 leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] md:text-sm"
              aria-label="Message"
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
                  className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]"
                  title="Attach files"
                  aria-label="Attach files"
                  disabled={busy || attachments.length >= 10}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="ph:paperclip" width={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                {busy ? (
                  <button
                    type="button"
                    onClick={cancelSend}
                    className="focus-ring grid h-7 w-7 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-danger)_90%,transparent)] text-white transition-colors hover:bg-[var(--color-danger)]"
                    title="Cancel (esc)"
                    aria-label="Cancel response"
                  >
                    <Icon name="ph:x-bold" width={13} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!input.trim() && attachments.length === 0}
                    className="focus-ring grid h-7 w-7 place-items-center rounded-md bg-[var(--accent-presence)] text-white transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-40"
                    title={`Send (${keys.enter})`}
                    aria-label="Send message"
                  >
                    <Icon name="ph:arrow-up-bold" width={13} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </footer>
      {csvRaw && csvModalOpen && (
        <CsvImportModal
          raw={csvRaw}
          familiar={familiar.id}
          onImport={(count) => {
            setCsvModalOpen(false);
            setCsvRaw(null);
            void count;
          }}
          onClose={() => setCsvModalOpen(false)}
        />
      )}
      {voiceCallOpen && sessionId && (
        <VoiceCallOverlay
          familiar={familiar}
          sessionId={sessionId}
          onClose={() => setVoiceCallOpen(false)}
        />
      )}
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
    <div className="flex items-center gap-2 py-2 text-[13px] text-[var(--text-muted)]">
      {/* Animated dots */}
      <span className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full animate-bounce bg-current"
            style={{
              animationDelay: `${i * 150}ms`,
              animationDuration: "900ms",
            }}
          />
        ))}
      </span>
      <span className="text-[11px] tabular-nums opacity-60">
        {elapsed}s
      </span>
    </div>
  );
}

// ── TurnRow ────────────────────────────────────────────────────────────────────

function FamiliarIcon({ familiar, size = "sm" }: { familiar: Familiar; size?: "sm" | "md" | "lg" }) {
  const overrides = useGlyphOverrides();
  const glyph = resolveFamiliarGlyph(familiar, overrides);
  return <FamiliarGlyph glyph={glyph} size={size} />;
}

function TurnRow({
  turn,
  familiar,
  showTimestamp = true,
}: {
  turn: Turn;
  familiar: Familiar;
  showTimestamp?: boolean;
}) {
  if (turn.role === "system" || turn.role === "user") {
    return (
      <div className={`cave-linear-turn cave-linear-turn--${turn.role}`}>
        <div className="cave-linear-turn-content">
          <div className="cave-linear-turn-meta">
            {turn.role === "system" ? (
              <span className="font-medium text-[var(--text-secondary)]">System</span>
            ) : null}
            {showTimestamp && turn.createdAt ? <span className="opacity-60">{fmtTime(turn.createdAt)}</span> : null}
            {turn.attachments?.length ? <span className="opacity-60">{turn.attachments.length} file{turn.attachments.length === 1 ? "" : "s"}</span> : null}
          </div>
          <MessageBubble
            role={turn.role}
            content={turn.text || (turn.attachments?.length ? "Attached files" : "")}
            timestamp={turn.createdAt}
            showTimestamp={false}
            pending={turn.pending}
          />
          {turn.attachments?.length ? <AttachmentList attachments={turn.attachments} /> : null}
        </div>
      </div>
    );
  }

  const duration = fmtDuration(turn.durationMs);
  const { visible, reasoning: inlineReasoning } = splitReasoning(turn.text);
  const reasoning = turn.reasoning?.trim() || inlineReasoning;
  const toolCount = turn.tools?.length ?? 0;
  const turnStatus = turn.lifecycle ?? (turn.error ? "failed" : turn.pending ? "streaming" : "complete");

  return (
    <div className="cave-linear-turn cave-linear-turn--assistant">
      <div className="cave-linear-turn-content text-[14px] leading-relaxed text-[var(--text-primary)] group/turn">
        {/* Avatar + right column */}
        <div className="cave-linear-turn-avatar" aria-hidden>
          <FamiliarIcon familiar={familiar} size="sm" />
        </div>
        <div className="cave-linear-turn-right">
          <div className="cave-linear-turn-meta">
            <span className="cave-linear-turn-name">{familiar.display_name}</span>
            {turnStatus !== "complete" && (
              <span className={`cave-turn-status cave-turn-status--${turnStatus}`}>
                {lifecycleLabel(turnStatus)}
              </span>
            )}
            {showTimestamp && turn.createdAt ? <span className="opacity-60">{fmtTime(turn.createdAt)}</span> : null}
            {duration && !turn.pending ? <span className="opacity-50">{duration}</span> : null}
            {toolCount ? <span className="opacity-60">{toolCount} tool{toolCount === 1 ? "" : "s"}</span> : null}
          </div>

          <div className="cave-linear-turn-body">
            {turn.pending && !visible ? (
              <ThinkingIndicator since={turn.createdAt} />
            ) : (
              <MessageBubble
                role="assistant"
                content={visible || (turn.pending ? "…" : "")}
                timestamp={turn.createdAt}
                showTimestamp={false}
                pending={turn.pending}
                isError={turn.error}
                label={familiar.display_name}
              />
            )}
            {reasoning ? <ReasoningBlock reasoning={reasoning} /> : null}
            {turn.tools?.length ? <ToolGroup tools={turn.tools} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  return (
    <details className="cave-reasoning-block mt-3" data-default-collapsed="true">
      <summary className="cave-tool-summary">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="ph:brain" width={12} aria-hidden />
          Thinking
        </span>
      </summary>
      <div className="mt-2 border-t border-[var(--border-hairline)]/70 pt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        <RichText text={reasoning} />
      </div>
    </details>
  );
}

function ToolGroup({ tools }: { tools: ToolEvent[] }) {
  const running = tools.filter((tool) => tool.status === "running").length;
  const errors = tools.filter((tool) => tool.status === "error").length;
  const completed = tools.length - running - errors;

  return (
    <details className="cave-tool-group mt-3" data-default-collapsed="true">
      <summary className="cave-tool-summary">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="ph:wrench" width={12} aria-hidden />
          Tool activity
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] normal-case tracking-normal text-[var(--text-muted)]">
          {running ? <span className="cave-tool-count cave-tool-count--running">{running} running</span> : null}
          {errors ? <span className="cave-tool-count cave-tool-count--error">{errors} error</span> : null}
          {completed ? <span className="cave-tool-count">{completed} done</span> : null}
        </span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-[var(--border-hairline)]/70 pt-2">
        {tools.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
      </div>
    </details>
  );
}

function ToolBlock({ tool }: { tool: ToolEvent }) {
  return (
    <details className="cave-tool-block" data-default-collapsed="true">
      <summary className="flex min-w-0 cursor-pointer select-none flex-wrap items-center gap-2 text-[11px]">
        <Icon name="ph:terminal-window" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
        <span className="min-w-0 truncate font-mono text-[var(--text-secondary)]">{tool.name}</span>
        <span className={[
          "rounded px-1.5 py-0.5 font-mono text-[10px]",
          tool.status === "error"
            ? "bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] text-[var(--color-danger)]"
            : tool.status === "running"
              ? "bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] text-[var(--color-warning)]"
              : "bg-[color-mix(in_oklch,var(--color-success)_18%,transparent)] text-[var(--color-success)]",
        ].join(" ")}>
          {tool.status}
        </span>
        {tool.durationMs ? (
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{fmtDuration(tool.durationMs)}</span>
        ) : null}
      </summary>
      {tool.input ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Input</div>
          <SyntaxBlock text={tool.input} />
        </div>
      ) : null}
      {tool.output ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Output</div>
          <SyntaxBlock text={tool.output} />
        </div>
      ) : null}
    </details>
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
        className="relative max-h-[90vh] w-[90vw] max-w-screen-2xl overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/60 px-4 py-2.5">
          <Icon name="ph:paperclip" width={13} className="shrink-0 text-[var(--text-muted)]" />
          <span className="flex-1 truncate text-[12px] text-[var(--text-secondary)]">{attachment.name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{fmtBytes(attachment.size)}</span>
          {attachment.truncated ? (
            <span className="shrink-0 rounded bg-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--color-warning)]">truncated</span>
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
          <div className="flex items-center justify-center overflow-hidden p-4">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              style={{ maxHeight: "75vh", maxWidth: "min(85vw, 100%)", width: "auto", height: "auto" }}
              className="rounded-lg object-contain block"
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
