"use client";

import { createContext, forwardRef, Fragment, memo, useCallback, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Familiar, SessionOrigin, SessionRow } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { MessageBubble, SyntaxBlock, type MessageBubbleSegment } from "@/components/message-bubble";
import { ChatArtifactViewer } from "@/components/chat-artifact-viewer";
import { buildSketchPrompt, extractArtifactBlocks, titleFromPrompt } from "@/lib/canvas-artifacts";
import { segmentTurn } from "@/lib/turn-segments";
import { isLiveSnapshotActive } from "@/lib/live-chat-snapshot";
import { createLiveGenerationRegistry, type LiveGenerationSnapshot } from "@/lib/live-chat-generations";
import { buildQuotedPrompt, buildReplySnippet, type ReplyTarget } from "@/lib/chat-reply";
import { canonicalize, formatHelp, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { Icon, type IconName } from "@/lib/icon";
import { useCopy } from "@/lib/use-copy";
import { Skeleton } from "@/components/ui/skeleton";
import { useKeySymbols } from "@/lib/platform-keys";
import { useVisualViewport } from "@/lib/use-viewport";
import { FamiliarIcon } from "@/components/familiar-icon";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { FamiliarInlineCard } from "@/components/familiar-inline-card";
import { ArtifactComments } from "@/components/artifact-comments";
import { SkillDetailPreview } from "@/components/skill-detail-preview";
import { ChatArchiveNudge } from "@/components/chat-archive-nudge";
import {
  isChatArchiveNudgeDismissed,
  markChatArchiveNudgeDismissed,
  shouldShowChatArchiveNudge,
} from "@/lib/chat-archive-nudge";
import type { ChatLinkedContext } from "@/lib/chat-linked-context";
import type { Card } from "@/lib/cave-board-types";
import { TaskLinkPicker } from "@/components/task-link-picker";
import { openExternalUrl } from "@/lib/open-external";
import {
  attachmentIcon,
  extractAgentAttachmentMarkers,
  fileToAttachment,
  hasDraggedFiles,
  stripPreviewOnlyAttachmentFieldsKeepingImages,
  type ChatAttachment,
  type ComposerAttachment,
} from "@/lib/chat-attachments";
import {
  FILE_MENTION_RESULT_LIMIT,
  fileMentionToken,
  filterFileMentions,
  MAX_FILE_MENTIONS,
} from "@/lib/file-mention";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { LOCAL_HOST_ID, parseConversationRuntime } from "@/lib/chat-hosts";
import { ComposerOptionsMenu, type ComposerOptionSection } from "@/components/composer-options-menu";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { DebugPane } from "@/components/debug-pane";
import { modelSlashOptions, resolveModelArg, formatModelList } from "@/lib/slash-model";
import {
  skillSlashOptions,
  resolveSkillInvocation,
  formatSkillList,
  buildSkillPrompt,
  skillCommandMatches,
  type SkillOption,
} from "@/lib/slash-skill";
import {
  promptSlashOptions,
  resolvePromptArg,
  formatPromptList,
  promptInsertion,
  type PromptOption,
} from "@/lib/slash-prompt";
import { BUILTIN_PROMPTS } from "@/lib/prompt-defaults";
import { PromptSnippetsModal, promptIconName } from "@/components/prompt-snippets-modal";
import { catalogForRuntime } from "@/lib/runtime-models";
import { clearChatDebugState, publishChatDebugState } from "@/lib/chat-debug-store";
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
import { VoiceCallOverlay } from "./voice-call-overlay";
import { ThreadSignalCard } from "@/components/thread-signal-card";
import { UserChatAvatar } from "@/components/user-chat-avatar";
import { usageBreakdown, usageSummary, type TurnUsage } from "@/lib/usage-format";
import {
  chatUsagePlanTooltip,
  formatChatUsagePlanSummary,
  type ChatUsagePlanSnapshot,
} from "@/lib/chat-usage-plan";
import { formatChatRecency, formatTimestamp, useDateTimePrefs } from "@/lib/datetime-format";
import { computeContextMeter } from "@/lib/context-meter";
import {
  formatRuntime,
  type ChatResponseMetadata,
} from "@/lib/chat-response-metadata";
import type { StreamEvent } from "@/lib/stream-events";
import { extractNextPaths } from "@/lib/next-paths";
import {
  NO_PROJECT_ID,
  chatProjectById,
  projectIdForRoot,
  resolveChatProjectSelection,
} from "@/lib/chat-projects";
import { addChatProject, projectNameForRoot } from "@/lib/chat-add-project";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  normalizeCommandControls,
  type CommandPermissionMode,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
  type InitialCommandControls,
} from "@/lib/command-controls";
import type { CaveProject } from "@/lib/cave-projects";
import { useProjects } from "@/lib/use-projects";
import { ProjectPicker, useAddProjectFlow } from "@/components/project-picker";
import { toolArgDetail, toolArgSummary } from "@/lib/tool-arg-summary";
import { toolVisual } from "@/lib/tool-visual";
import { toolReadableFields, prettyToolOutput, type ReadableField } from "@/lib/tool-readable";
import { useShowThinking } from "@/lib/reasoning-visibility";
import { toolInputAsDiff, toolTargetFile, toolTargetPath } from "@/lib/tool-input-diff";
import { diffStat } from "@/lib/tool-edit-stat";
import { findMatchingTurnIds } from "@/lib/transcript-find";
import { isSyntheticLocalModel, type ChatModelState } from "@/lib/chat-model-state";
import { readComposerHistory, writeComposerHistory } from "@/lib/composer-history";
import { resolveActivePath, buildSiblingIndex, childLeaf } from "@/lib/conversation-tree";
import { appendCollapsingNewlines } from "@/lib/stream-text";
import { stripStepMarkers } from "@/lib/workflow-step-progress";
import {
  buildReflectTranscript,
  buildThreadReflectPrompt,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";
import { streamFamiliarText } from "@/lib/familiar-stream";
import { buildPromptEnhancement } from "@/lib/prompt-enhancer";

type ToolEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
  /** CHAT-D4-01: length of the turn's accumulated text when this tool's
   *  FIRST event arrived — lets TurnRow interleave the tool block at its
   *  chronological position between prose spans. Absent on tool events from
   *  stored transcripts that predate the field (legacy turns keep the
   *  trailing rollup). */
  textOffset?: number;
};

type ProgressEvent = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  createdAt: string;
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
  parentId?: string | null;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ToolEvent[];
  progress?: ProgressEvent[];
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  lifecycle?: ChatTurnLifecycle;
  durationMs?: number;
  /** Token usage / cost from the harness result event (CHAT-D12-02).
   *  Absent when the harness emitted none (e.g. the OpenClaw bridge). */
  usage?: TurnUsage;
  costUsd?: number;
  responseMetadata?: ChatResponseMetadata;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

// CHAT-D3-07 perf: `replyFor` runs for every row on every render and parses the
// turn text (strip reasoning + Next paths) to decide whether the Reply action
// shows. During streaming that would re-parse the whole settled transcript on
// each token. Cache the boolean decision by the stable turn reference — settled
// turns keep their object, so they hit; only the streaming turn gets a fresh ref
// (correct miss). Module-scoped and keyed weakly, so dead turns are GC'd; the
// value is a pure function of the turn, so sharing across instances is safe.
const replyableTurnCache = new WeakMap<Turn, boolean>();

type LiveChatGenerationSnapshot = LiveGenerationSnapshot<Turn>;

function cloneLiveTurn(turn: Turn): Turn {
  return {
    ...turn,
    attachments: turn.attachments ? [...turn.attachments] : undefined,
    tools: turn.tools ? turn.tools.map((tool) => ({ ...tool })) : undefined,
    progress: turn.progress ? turn.progress.map((progress) => ({ ...progress })) : undefined,
  };
}

// Module-scope so a generation outlives the ChatView instance that started
// it (thread switches AND full surface unmounts — cave-0er). All streaming
// mutations must go through the registry (see updateLiveTurns), never only
// through component setState: React silently drops setState on an unmounted
// instance, which used to freeze the snapshot mid-generation and lose the
// response. See src/lib/live-chat-generations.ts.
const liveChatRegistry = createLiveGenerationRegistry<Turn>(cloneLiveTurn);

function readLiveChatGeneration(sessionId: string): LiveChatGenerationSnapshot | null {
  return liveChatRegistry.read(sessionId);
}

function recordLiveChatGeneration(snapshot: LiveChatGenerationSnapshot): LiveChatGenerationSnapshot {
  return liveChatRegistry.record(snapshot);
}

function clearLiveChatGeneration(sessionId: string | null | undefined) {
  liveChatRegistry.clear(sessionId);
}

function subscribeLiveChatGeneration(
  sessionId: string,
  listener: (snapshot: LiveChatGenerationSnapshot | null) => void,
) {
  return liveChatRegistry.subscribe(sessionId, listener);
}

// `isLiveSnapshotActive` lives in @/lib/live-chat-snapshot so the staleness rule
// (the guard that stops a remounted view from inheriting a zombie "Streaming…"
// state) can be unit-tested without React. The full LiveChatGenerationSnapshot
// is structurally assignable to the helper's minimal SnapshotLiveness shape.

type Props = {
  familiar: Familiar;
  sessionId: string | null;
  session?: SessionRow | null;
  projectRoot?: string;
  /** Prompt handed off from the home composer. Auto-sent once on mount so the
   *  send runs through this view's streaming path instead of a detached fetch. */
  initialPrompt?: string;
  /** Files handed off from the home composer alongside `initialPrompt`; included
   *  in the auto-sent first message. */
  initialAttachments?: ChatAttachment[];
  initialControls?: InitialCommandControls;
  /** Provenance for a newly-created conversation (e.g. "eval" for eval-discuss
   *  threads). Persisted on the conversation so it can be surfaced/hidden by origin. */
  origin?: SessionOrigin;
  /** When set (with a changing nonce), opens the in-thread find on this query —
   *  used by the ⌘K Conversations result to jump to the matched message. */
  openFindQuery?: string;
  openFindNonce?: number;
  daemonRunning?: boolean;
  /** Workspace-owned session list; the starting page's "Continue" row reads it
   *  so no extra fetch rides on every new chat. */
  sessions?: SessionRow[];
  onSessionStarted?: (sessionId: string) => void;
  onSessionsChanged?: () => void;
  onBack?: () => void;
  onSlashCommand?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  /** Reverse navigation for a chat that's linked to a board task — clicking
   *  the Task chip in the context strip routes back to the board with the
   *  card focused. The link is bidirectional; this is the chat→task side. */
  onOpenTask?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
  onProjectRootChange?: (projectRoot: string | null) => void;
};

export type ChatViewHandle = {
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};

type ChatHistoryState = "idle" | "loading" | "loaded" | "missing" | "error";

function isFlowBackedSession(session: SessionRow | null | undefined): boolean {
  const origin = session?.origin as string | undefined;
  const title = session?.title?.trim() ?? "";
  return origin === "flow" || title.startsWith("Flow: ") || title.startsWith("Flow step: ");
}

async function loadFlowSessionTranscript(sessionId: string): Promise<string | null> {
  const params = new URLSearchParams({ sessionId });
  try {
    const res = await fetch(`/api/flows/session-transcript?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json() as { ok?: boolean; transcript?: string };
    const transcript = typeof json.transcript === "string" ? json.transcript.trim() : "";
    if (!json.ok || !transcript) return null;
    return transcript;
  } catch {
    return null;
  }
}
type FailedSend = {
  text: string;
  attachments: ChatAttachment[];
  mentionedFiles?: string[];
  promptOverride?: string;
};
type ComposerThinkingEffort = CommandThinkingEffort;
type ComposerResponseSpeed = CommandResponseSpeed;

// Fallback cap when the computed CSS max-height can't be read; kept in sync with
// the .cave-composer-input rule (13 lines: 13*24 + 20px padding).
const COMPOSER_MAX_HEIGHT = 332;
const COMPOSER_PREFS_KEY = "cave:chat-composer-controls:v1";
// Persist the in-progress composer text so a page reload doesn't eat a
// half-written message. The composer is a single shared input (it isn't
// remounted per session), so one key mirrors the in-memory behaviour.
const COMPOSER_DRAFT_KEY = "cave:chat-composer-draft:v1";
const COMPOSER_DRAFT_WRITE_DELAY_MS = 250;
// Persisted ↑/↓ prompt-history recall stack for the chat composer.
const COMPOSER_HISTORY_KEY = "cave:chat-composer-history:v1";
// Initial render cap: while the reader is pinned to the newest content, only the
// last N grouped turns are mounted, so opening a long transcript doesn't build
// hundreds of DOM nodes up front (off-screen rows already get
// content-visibility:auto, but the nodes still cost mount + memory). The moment
// the reader scrolls up or opens find — both routed through updateFollowing /
// the find effect — the full transcript renders, so seeking, find, and deep
// scroll are never limited by the cap.
const TRANSCRIPT_RENDER_CAP = 60;
const THINKING_OPTIONS = COMMAND_THINKING_OPTIONS;
const SPEED_OPTIONS = COMMAND_RESPONSE_SPEED_OPTIONS;
const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "video/*",
  "application/pdf",
  "application/json",
  "text/*",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".rs",
  ".go",
  ".py",
  ".rb",
  ".swift",
  ".java",
  ".kt",
  ".sh",
  ".zsh",
  ".fish",
  ".sql",
  ".log",
].join(",");

function readComposerPrefs(): {
  thinkingEffort: ComposerThinkingEffort;
  responseSpeed: ComposerResponseSpeed;
  permissionMode: CommandPermissionMode;
} {
  if (typeof window === "undefined") return { ...COMMAND_CONTROL_DEFAULTS, permissionMode: DEFAULT_PERMISSION_MODE };
  try {
    const raw = window.localStorage.getItem(COMPOSER_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<{ thinkingEffort: string; responseSpeed: string; permissionMode: string }> : {};
    const thinkingEffort = THINKING_OPTIONS.some((option) => option.value === parsed.thinkingEffort)
      ? parsed.thinkingEffort as ComposerThinkingEffort
      : COMMAND_CONTROL_DEFAULTS.thinkingEffort;
    const responseSpeed = SPEED_OPTIONS.some((option) => option.value === parsed.responseSpeed)
      ? parsed.responseSpeed as ComposerResponseSpeed
      : COMMAND_CONTROL_DEFAULTS.responseSpeed;
    const permissionMode = PERMISSION_MODES.some((mode) => mode.value === parsed.permissionMode)
      ? parsed.permissionMode as CommandPermissionMode
      : DEFAULT_PERMISSION_MODE;
    return { thinkingEffort, responseSpeed, permissionMode };
  } catch {
    return { ...COMMAND_CONTROL_DEFAULTS, permissionMode: DEFAULT_PERMISSION_MODE };
  }
}

function writeComposerPrefs(prefs: {
  thinkingEffort: ComposerThinkingEffort;
  responseSpeed: ComposerResponseSpeed;
  permissionMode: CommandPermissionMode;
}) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* best effort */
  }
}

function readComposerDraft(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(COMPOSER_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeComposerDraft(text: string) {
  if (typeof window === "undefined") return;
  try {
    if (text) window.localStorage.setItem(COMPOSER_DRAFT_KEY, text);
    else window.localStorage.removeItem(COMPOSER_DRAFT_KEY);
  } catch {
    /* best effort */
  }
}

function shouldKeepLiveNewChatState({
  sessionId,
  currentSessionId,
  liveSessionId,
  turnCount,
}: {
  sessionId: string | null;
  currentSessionId: string | null;
  liveSessionId: string | null;
  turnCount: number;
}): boolean {
  return Boolean(
    sessionId &&
      currentSessionId === sessionId &&
      (turnCount > 0 || liveSessionId === sessionId),
  );
}

function upsertProgressEvent(
  progress: ProgressEvent[] | undefined,
  incoming: {
    id?: string;
    label: string;
    detail?: string;
    status?: "running" | "done" | "error";
    durationMs?: number;
    createdAt?: string;
  },
): ProgressEvent[] {
  const event: ProgressEvent = {
    id: incoming.id ?? crypto.randomUUID(),
    label: incoming.label,
    detail: incoming.detail,
    status: incoming.status ?? "running",
    createdAt: incoming.createdAt ?? new Date().toISOString(),
    durationMs: incoming.durationMs,
  };
  const existing = progress?.findIndex((item) => item.id === event.id) ?? -1;
  if (existing < 0) return [...(progress ?? []), event];
  return (progress ?? []).map((item, index) =>
    index === existing
      ? {
          ...item,
          ...event,
          detail: event.detail ?? item.detail,
          durationMs: event.durationMs ?? item.durationMs,
        }
      : item,
  );
}

function settleRunningProgress(
  progress: ProgressEvent[] | undefined,
  status: "done" | "error",
): ProgressEvent[] | undefined {
  if (!progress?.length) return progress;
  return progress.map((item) => (item.status === "running" ? { ...item, status } : item));
}

function fmtDuration(ms?: number): string | null {
  if (ms == null || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function DurationText({ durationMs }: { durationMs?: number }) {
  const duration = fmtDuration(durationMs);
  return duration ? <span className="font-mono text-[10px] text-[var(--text-muted)]">{duration}</span> : null;
}

type ErrorStripTool = { id: string; name: string; input?: string; output?: string; status: "running" | "ok" | "error"; durationMs?: number };
type ErrorStripStep = { id: string; label: string; detail?: string; status: "running" | "done" | "error" };
type ErrorStripTurn = { tools?: ErrorStripTool[]; progress?: ErrorStripStep[]; lifecycle?: string };

/** Inline error/debug strip between the transcript and the composer. Shows the
 *  latest chat error message + code, and (expandable) the failing turn's errored
 *  tool/step output so the debug detail is visible without opening the side
 *  Debug pane. Auto-expands on every new error (keyed on `errorSeq`). */
function ChatErrorStrip({
  message,
  code,
  errorSeq,
  failingTurn,
  canRetry,
  busy,
  onRetry,
  onOpenDebug,
  onDismiss,
  addProjectLabel,
  addingProject,
  onAddProject,
}: {
  message: string;
  code?: string;
  errorSeq: number;
  failingTurn: ErrorStripTurn | null;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
  onOpenDebug: () => void;
  onDismiss: () => void;
  /** When set, this failure was a 403 project-access denial: render a primary
   *  action that registers the chat's cwd as a project and retries. */
  addProjectLabel?: string;
  addingProject?: boolean;
  onAddProject?: () => void;
}) {
  const { copied, copy } = useCopy();
  const erroredTools = (failingTurn?.tools ?? []).filter((t) => t.status === "error");
  const erroredSteps = (failingTurn?.progress ?? []).filter((p) => p.status === "error");
  const hasDetail = Boolean(code) || erroredTools.length > 0 || erroredSteps.length > 0;
  const [open, setOpen] = useState(true);
  // Re-expand whenever a *new* error fires so the latest detail is front-and-centre.
  useEffect(() => {
    setOpen(true);
  }, [errorSeq]);

  const detailText = useMemo(() => {
    const lines: string[] = [message];
    if (code) lines.push(`code: ${code}`);
    for (const t of erroredTools) {
      const dur = fmtDuration(t.durationMs);
      lines.push(`\ntool: ${t.name} ✗ error${dur ? ` (${dur})` : ""}`);
      if (t.input) lines.push(t.input);
      if (t.output) lines.push(t.output);
    }
    for (const p of erroredSteps) {
      lines.push(`\nstep: ${p.label} ✗ error`);
      if (p.detail) lines.push(p.detail);
    }
    return lines.join("\n");
  }, [message, code, erroredTools, erroredSteps]);

  const btn =
    "focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_42%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium text-[var(--color-warning)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40";
  const pre =
    "mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-base)]/40 px-2 py-1 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]";

  return (
    <div
      role="alert"
      className="cave-chat-error-strip shrink-0 border-t border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]"
    >
      <div className="flex items-center gap-2 px-5 py-2 text-xs">
        <Icon name="ph:warning-fill" width={13} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{message}</span>
        {code ? (
          <span className="shrink-0 rounded border border-[color-mix(in_oklch,var(--color-warning)_42%,transparent)] bg-[var(--bg-base)]/35 px-1.5 py-0.5 font-mono text-[10px]">
            {code}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {hasDetail ? (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={btn}>
              <Icon name={open ? "ph:caret-down-bold" : "ph:caret-right-bold"} width={11} aria-hidden />
              {open ? "Hide" : "Details"}
            </button>
          ) : null}
          <button type="button" onClick={() => copy(detailText)} className={btn}>
            <Icon name={copied ? "ph:check-bold" : "ph:copy"} width={11} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={onOpenDebug} className={btn}>
            <Icon name="ph:bug-bold" width={11} aria-hidden />
            Debug
          </button>
          {onAddProject ? (
            <button
              type="button"
              onClick={onAddProject}
              disabled={addingProject}
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--accent-presence)]/50 bg-[color-mix(in_oklch,var(--accent-presence)_16%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--accent-presence)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_24%,transparent)] disabled:opacity-40"
            >
              <Icon name={addingProject ? "ph:arrows-clockwise" : "ph:folders-bold"} width={11} className={addingProject ? "animate-spin" : undefined} aria-hidden />
              {addingProject ? "Adding…" : (addProjectLabel ?? "Add project")}
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" onClick={onRetry} disabled={busy} className={btn}>
              <Icon name="ph:arrow-clockwise" width={11} aria-hidden />
              Retry
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} aria-label="Dismiss error" className={btn}>
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
      </div>
      {hasDetail && open ? (
        <div className="max-h-48 overflow-auto border-t border-[color-mix(in_oklch,var(--color-warning)_22%,transparent)] px-5 py-2">
          {erroredTools.map((t) => (
            <div key={t.id} className="mb-2 last:mb-0">
              <div className="text-[11px] font-semibold text-[var(--color-warning)]">
                tool: {t.name} ✗ error{t.durationMs != null ? ` · ${fmtDuration(t.durationMs)}` : ""}
              </div>
              {t.input ? <pre className={pre}>{t.input}</pre> : null}
              {t.output ? <pre className={pre}>{t.output}</pre> : null}
            </div>
          ))}
          {erroredSteps.map((p) => (
            <div key={p.id} className="mb-2 last:mb-0">
              <div className="text-[11px] font-semibold text-[var(--color-warning)]">step: {p.label} ✗ error</div>
              {p.detail ? <pre className={pre}>{p.detail}</pre> : null}
            </div>
          ))}
          {erroredTools.length === 0 && erroredSteps.length === 0 ? (
            <div className="text-[11px] text-[var(--text-secondary)]">
              No tool output captured for this turn. Open Debug for the full session events.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** CHAT-D12-02: compact per-turn token/cost readout ("12.4k tok · $0.08")
 *  with the full breakdown in the tooltip. Renders nothing when the harness
 *  emitted no usage (e.g. the OpenClaw bridge). */
function UsageText({ usage, costUsd }: { usage?: TurnUsage; costUsd?: number }) {
  const summary = usageSummary(usage, costUsd);
  if (!summary) return null;
  return (
    <span
      className="font-mono text-[10px] text-[var(--text-muted)]"
      title={usageBreakdown(usage, costUsd) ?? undefined}
    >
      {summary}
    </span>
  );
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

function compactGitHubContextLabel(item: ChatLinkedContext["github"][number]): string {
  const repo = repoName(item.repo) || item.repo;
  return item.number ? `${repo} #${item.number}` : repo;
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
  // Strip upstream debug-prefix lines (e.g. "[model-fallback/decision] …")
  // that leak into the assistant transcript. Anchored to line start so
  // inline brackets in prose are untouched.
  const DEBUG_PREFIX_RE = /^\[[a-z][\w-]*(?:\/[\w-]+)+\][^\n]*\n?/gim;
  return {
    visible: visible.replace(DEBUG_PREFIX_RE, "").replace(/\n{3,}/g, "\n\n").trimStart(),
    reasoning: reasoningParts.join("\n\n").trim(),
  };
}

// ── ChatEmptyState ────────────────────────────────────────────────────────────
// The familiar's task-aware starting page lives in chat-empty-state.tsx; this
// view arms/executes its "Start a task" card-follows-chat flow (see
// handleEvent's "session" case).

/** Codex/ChatGPT-style overflow menu. Collapses the session's secondary
 *  controls — project switch, voice call, debug — into a single kebab so the
 *  header reads as title + quiet metadata instead of a row of competing icons.
 *  Find and Delete stay inline (one-click); everything else lives one click away
 *  here. */
function SessionOverflowMenu({
  projects,
  projectId,
  onProjectChange,
  onAddProject,
  familiar,
  voiceActive,
  onOpenVoice,
  onOpenDebug,
}: {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (value: string) => void;
  /** Opens the shared add-project flow (register + grant) — proactive, not 403-recovery-only. */
  onAddProject?: () => void;
  familiar: Familiar;
  voiceActive: boolean;
  onOpenVoice: () => void;
  onOpenDebug: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeProject =
    projectId === NO_PROJECT_ID
      ? null
      : (projectId ? chatProjectById(projectId, projects) ?? projects[0] : projects[0]) ?? null;
  const voiceConfigured = Boolean(familiar.voiceProvider);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring cave-chat-actions-kebab"
        aria-label="Session options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Session options"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="ph:dots-three-vertical" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={216}
        ariaLabel="Chat options"
      >
        <PopoverBody>
          <PopoverItem
            icon="ph:pencil-simple"
            onSelect={() => {
              window.dispatchEvent(new Event("cave:chat-rename"));
              close();
            }}
          >
            Rename chat
          </PopoverItem>
          <PopoverSeparator />
          {projects.length > 0 || onAddProject ? (
            <>
              <PopoverLabel>Project</PopoverLabel>
              {projects.length > 0 ? (
                <>
                  <PopoverItem
                    icon={activeProject ? "ph:folder" : "ph:check"}
                    active={!activeProject}
                    onSelect={() => {
                      onProjectChange(NO_PROJECT_ID);
                      close();
                    }}
                  >
                    No project
                  </PopoverItem>
                  {projects.map((entry) => (
                    <PopoverItem
                      key={entry.id}
                      icon={entry.id === activeProject?.id ? "ph:check" : "ph:folder"}
                      active={entry.id === activeProject?.id}
                      onSelect={() => {
                        onProjectChange(entry.id);
                        close();
                      }}
                    >
                      {entry.name}
                    </PopoverItem>
                  ))}
                </>
              ) : null}
              {onAddProject ? (
                <PopoverItem
                  icon="ph:plus"
                  onSelect={() => {
                    onAddProject();
                    close();
                  }}
                >
                  Add project…
                </PopoverItem>
              ) : null}
              <PopoverSeparator />
            </>
          ) : null}
          <PopoverItem
            icon="ph:phone"
            disabled={!voiceConfigured || voiceActive}
            onSelect={() => {
              onOpenVoice();
              close();
            }}
          >
            {voiceConfigured ? `Call ${familiar.display_name}` : "Voice — set up in Studio"}
          </PopoverItem>
          <PopoverItem
            icon="ph:bug-bold"
            onSelect={() => {
              onOpenDebug();
              close();
            }}
          >
            Debug session
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </>
  );
}

/** Header toggle for the global "Show thinking" preference — flips every
 *  reasoning disclosure in the transcript open/closed at once. */
function HeaderThinkingToggle() {
  const [showThinking, setShowThinking] = useShowThinking();
  return (
    <button
      type="button"
      className={`focus-ring cave-chat-icon-button${showThinking ? " cave-chat-icon-button--active" : ""}`}
      aria-label={showThinking ? "Hide thinking" : "Show thinking"}
      aria-pressed={showThinking}
      title={showThinking ? "Hide reasoning blocks" : "Show reasoning blocks"}
      onClick={() => setShowThinking(!showThinking)}
    >
      <Icon name={showThinking ? "ph:brain-bold" : "ph:brain"} width={15} aria-hidden />
    </button>
  );
}

function HeaderDebugButton({ onOpenDebug }: { onOpenDebug: () => void }) {
  return (
    <button
      type="button"
      className="focus-ring cave-chat-icon-button"
      aria-label="Debug chat"
      title="Debug chat"
      onClick={onOpenDebug}
    >
      <Icon name="ph:bug-bold" width={15} aria-hidden />
    </button>
  );
}

function HeaderReflectButton({
  reflecting,
  onReflect,
}: {
  reflecting: boolean;
  onReflect: () => void;
}) {
  return (
    <button
      type="button"
      className="focus-ring cave-chat-icon-button"
      aria-label="Reflect on this thread"
      title="Reflect on this thread"
      disabled={reflecting}
      onClick={onReflect}
    >
      <Icon
        name={reflecting ? "ph:circle-notch-bold" : "ph:brain-bold"}
        width={15}
        className={reflecting ? "animate-spin" : undefined}
        aria-hidden
      />
    </button>
  );
}

/** Standalone delete control for the chat header — a one-click trash button that
 *  opens a small confirm popover before committing. Mirrors the overflow menu's
 *  two-step guard, but surfaced at the top of the session for quick access. Uses
 *  its own open state so it never collides with the kebab's armed state; the
 *  in-flight `deleting` flag and the actual delete are shared via props. */
function HeaderDeleteButton({
  onDelete,
  deleting,
}: {
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring cave-chat-delete-trigger"
        aria-label="Delete chat"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Delete chat"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="ph:trash" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={216}
        ariaLabel="Delete chat"
      >
        <PopoverBody>
          <PopoverLabel>Delete this chat permanently?</PopoverLabel>
          <PopoverItem icon="ph:x" onSelect={() => setOpen(false)}>
            Cancel
          </PopoverItem>
          <PopoverItem icon="ph:trash" danger disabled={deleting} onSelect={() => onDelete()}>
            {deleting ? "Deleting…" : "Delete chat"}
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </>
  );
}

// Message-shaped placeholder shown while an existing transcript is restoring —
// alternating assistant (left) / user (right) ghost bubbles instead of a bare
// notice, matching the app-wide skeleton convention.
function ChatHistorySkeleton() {
  const rows: { side: "left" | "right"; width: string; lines: number }[] = [
    { side: "left", width: "62%", lines: 3 },
    { side: "right", width: "46%", lines: 2 },
    { side: "left", width: "70%", lines: 2 },
    { side: "right", width: "38%", lines: 1 },
    { side: "left", width: "56%", lines: 3 },
  ];
  return (
    <div className="flex flex-col gap-5 py-4" role="status" aria-label="Loading chat history">
      {rows.map((row, i) => (
        <div key={i} className={`flex ${row.side === "right" ? "justify-end" : "justify-start"}`}>
          <div
            className="flex flex-col gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3"
            style={{ width: row.width, maxWidth: "72%" }}
          >
            {Array.from({ length: row.lines }).map((_, l) => (
              <Skeleton key={l} variant="text" width={l === row.lines - 1 ? "70%" : "100%"} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatHistoryNotice({
  title,
  body,
  onRetry,
  onBack,
}: {
  title: string;
  body: string;
  onRetry?: (() => void) | null;
  onBack?: (() => void) | null;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-6 py-7 text-center">
      <Icon name="ph:chats" width={20} className="mb-3 text-[var(--text-muted)]" />
      <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1.5 max-w-[28ch] text-[12px] leading-[1.55] text-[var(--text-muted)]">{body}</p>
      {(onRetry || onBack) && (
        <div className="mt-4 flex gap-2">
          {onBack && (
            <button
              type="button"
              className="cave-btn cave-btn--ghost cave-btn--sm"
              onClick={onBack}
            >
              Back to sessions
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              className="cave-btn cave-btn--primary cave-btn--sm"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FlowSessionTranscriptFallback({
  transcript,
  onRetry,
  onBack,
}: {
  transcript: string;
  onRetry?: (() => void) | null;
  onBack?: (() => void) | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4 text-left">
      <div className="flex items-start gap-3">
        <Icon name="ph:flow-arrow" width={20} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">Flow session output</p>
          <p className="mt-1 max-w-[68ch] text-[12px] leading-[1.5] text-[var(--text-muted)]">
            This flow session has no saved chat transcript yet, so CovenCave is showing the flow output instead.
          </p>
        </div>
        {(onRetry || onBack) && (
          <div className="flex shrink-0 gap-2">
            {onBack && (
              <button
                type="button"
                className="cave-btn cave-btn--ghost cave-btn--sm"
                onClick={onBack}
              >
                Back
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="cave-btn cave-btn--primary cave-btn--sm"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <pre className="mt-4 max-h-[min(58vh,640px)] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-4 font-mono text-[12px] leading-relaxed text-[var(--text-primary)]">{transcript}</pre>
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

  // The rename affordance now lives in the session overflow menu (Codex/ChatGPT
  // idiom — a clean title, secondary actions one click away). The menu fires
  // this event; clicking the title itself still enters edit mode directly.
  useEffect(() => {
    const onRename = () => setEditing(true);
    window.addEventListener("cave:chat-rename", onRename);
    return () => window.removeEventListener("cave:chat-rename", onRename);
  }, []);

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

function visibleModelId(model: string | null | undefined, harness: string | null | undefined): string | null {
  const trimmed = model?.trim();
  if (!trimmed || isSyntheticLocalModel(trimmed, harness)) return null;
  return trimmed;
}

/** Header display label for a model id: drop a leading vendor segment
 *  ("anthropic/…") and a "claude-" prefix so the meta line reads "opus-4-8"
 *  instead of "anthropic/claude-opus-4-8". The full id still rides in the meta
 *  line's title tooltip for provenance. Non-Claude / bare ids pass through
 *  unchanged ("openai/gpt-5.5" → "gpt-5.5", "gpt-5.5" → "gpt-5.5"). */
function shortModelLabel(model: string): string {
  const afterVendor = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return afterVendor.replace(/^claude-/i, "") || afterVendor;
}

function responseMetadataModel(metadata?: ChatResponseMetadata): string | null {
  const confirmed = metadata?.confirmedModel?.trim();
  const requested = metadata?.model?.trim();
  return (
    visibleModelId(confirmed, metadata?.harness) ??
    visibleModelId(requested, metadata?.harness)
  );
}

type MetaLineState = "complete" | "streaming" | "failed" | "offline";

function metaLineState(args: {
  busy: boolean;
  lifecycle: ChatTurnLifecycle | null;
  error: boolean;
  daemonRunning: boolean | undefined;
}): MetaLineState {
  if (args.daemonRunning === false) return "offline";
  if (args.lifecycle === "failed" || args.error) return "failed";
  if (args.busy || args.lifecycle === "queued" || args.lifecycle === "connecting" || args.lifecycle === "streaming" || args.lifecycle === "tooling") return "streaming";
  return "complete";
}

/** A directory segment renders with a folder icon (the runtime IS the working
 *  directory — see formatRuntime); plain strings render as text. */
type MetaSegment = string | { dir: { label: string; title: string } };

function metaLineSegments(args: {
  state: MetaLineState;
  lifecycle: ChatTurnLifecycle | null;
  harness?: string;
  model?: string;
  runtime?: string | null;
  projectRoot?: string | null;
  durationMs?: number;
  usage?: TurnUsage;
  costUsd?: number;
}): MetaSegment[] {
  const segs: MetaSegment[] = [];
  // The runtime is the cwd; fall back to the project root so a directory shows
  // even before the first turn records runtime metadata. No dishonest "model:"
  // / "runtime:" labels — the harness and agent profile read bare, the cwd
  // reads as a folder.
  const runtime = formatRuntime(args.runtime) ?? formatRuntime(args.projectRoot ? `local:${args.projectRoot}` : null);
  if (args.state === "offline") {
    segs.push("daemon offline · check Coven");
  } else if (args.state === "failed") {
    if (args.model) segs.push(shortModelLabel(args.model));
    if (runtime) segs.push({ dir: runtime });
    segs.push("failed");
  } else if (args.state === "streaming") {
    if (args.model) segs.push(shortModelLabel(args.model));
    if (runtime) segs.push({ dir: runtime });
    segs.push(args.lifecycle === "tooling" ? "using tools…" : args.lifecycle === "connecting" || args.lifecycle === "queued" ? "connecting…" : "writing…");
    // CHAT-D3-06: the "· 14s" ticker + esc hint tail is rendered by MetaLine
    // itself so the ticking elapsed can live in an aria-hidden span — keeping
    // the per-second rewrite out of the role="status" live region.
  } else {
    // Lead with the model (ChatGPT idiom) — the harness name is redundant with
    // it, so it only appears as a fallback when no model id is resolved.
    if (args.model) segs.push(shortModelLabel(args.model));
    else if (args.harness) segs.push(args.harness);
    if (runtime) segs.push({ dir: runtime });
    const dur = fmtDuration(args.durationMs);
    if (dur) segs.push(dur);
    // CHAT-D12-02: "… · 7s · 12.4k tok · $0.08" — absent when the harness
    // emitted no usage (e.g. the OpenClaw bridge).
    const usage = usageSummary(args.usage, args.costUsd);
    if (usage) segs.push(usage);
  }
  return segs;
}

/** One-line provenance peek for a settled assistant turn — model · cwd ·
 *  duration · tokens · cost. These are the same facts the header MetaLine shows
 *  for the LATEST turn, assembled here for an arbitrary turn so they can hang
 *  off a per-turn hover affordance — older turns become inspectable without a
 *  trip through the debug pane. Uses the full cwd path (not the truncated
 *  label) since it lands in a title tooltip. Returns null when the turn carries
 *  no such metadata (e.g. a bridge harness that emits no usage/runtime). */
function turnMetaPeekTitle(turn: Turn): string | null {
  const parts: string[] = [];
  const model = responseMetadataModel(turn.responseMetadata);
  if (model) parts.push(model);
  const runtime = formatRuntime(turn.responseMetadata?.runtime ?? null);
  if (runtime) parts.push(runtime.title);
  const dur = fmtDuration(turn.durationMs);
  if (dur) parts.push(dur);
  const usage = usageSummary(turn.usage, turn.costUsd);
  if (usage) parts.push(usage);
  return parts.length ? parts.join(" · ") : null;
}

/** In-transcript find bar (CHAT-D9-04). Collapsed: a search icon button in
 *  the meta line. Expanded: query input + `n / m` matching-TURN count +
 *  prev/next/close, styled to extend the meta line without displacing the
 *  rename/voice/debug/delete actions. Esc layering is self-contained: the
 *  input's own onKeyDown stops propagation so closing find never reaches the
 *  composer's Esc handling (slash dismiss / stream cancel). */
function ChatFindBar({
  open,
  query,
  activeIndex,
  matchCount,
  focusNonce,
  onOpen,
  onClose,
  onQueryChange,
  onNext,
  onPrev,
}: {
  open: boolean;
  query: string;
  /** 0-based index of the active match; rendered 1-based. */
  activeIndex: number;
  matchCount: number;
  /** Bumped on every section-level ⌘F so an already-open bar refocuses. */
  focusNonce: number;
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusNonce]);

  if (!open) {
    return (
      <button
        type="button"
        className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        title="Find in conversation (⌘F)"
        aria-label="Find in conversation"
        onClick={onOpen}
      >
        <Icon name="ph:magnifying-glass" width={12} aria-hidden />
      </button>
    );
  }

  return (
    <span className="cave-chat-find" role="search" aria-label="Find in conversation">
      <Icon name="ph:magnifying-glass" width={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) onPrev();
            else onNext();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find in chat…"
        aria-label="Find in conversation"
        className="cave-chat-find__input"
      />
      <span className="cave-chat-find__count" aria-live="polite">
        {matchCount > 0 ? `${activeIndex + 1} / ${matchCount}` : "0 / 0"}
      </span>
      <button
        type="button"
        className="cave-chat-find__nav focus-ring"
        aria-label="Previous match"
        title="Previous match (shift+enter)"
        disabled={matchCount === 0}
        onClick={onPrev}
      >
        <Icon name="ph:caret-up" width={10} aria-hidden />
      </button>
      <button
        type="button"
        className="cave-chat-find__nav focus-ring"
        aria-label="Next match"
        title="Next match (enter)"
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <Icon name="ph:caret-down" width={10} aria-hidden />
      </button>
      <button
        type="button"
        className="cave-chat-find__nav focus-ring"
        aria-label="Close find"
        title="Close find (esc)"
        onClick={onClose}
      >
        <Icon name="ph:x-bold" width={9} aria-hidden />
      </button>
    </span>
  );
}

/** CHAT-D3-06: compact ticking elapsed for the streaming/tooling meta line,
 *  so the wall-clock counter survives past the first token (ThinkingIndicator
 *  swaps to text and takes its counter with it). Same 1s interval pattern as
 *  ThinkingIndicator. SR-quiet by construction: the span is aria-hidden INSIDE
 *  the role="status" live region, so the per-second rewrite is excluded from
 *  the accessibility tree and never announced (the rewrites-per-second
 *  problem from CHAT-D12-04). */
function MetaLineElapsed({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(since).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since]);
  return (
    <span aria-hidden="true" className="cave-chat-meta-line__elapsed">{` · ${elapsed}s`}</span>
  );
}

/** Compact context-window meter for the completed-turn meta line: a tiny bar +
 *  percentage sized against the model's context window, fed by the latest
 *  turn's token usage. Null when the harness reported no usage (e.g. the
 *  OpenClaw bridge) or the model/window can't be resolved. The bar fill warms
 *  from accent → amber → red as the window fills. */
function ContextMeterChip({ usage, model }: { usage?: TurnUsage; model?: string }) {
  const meter = computeContextMeter(usage, model);
  if (!meter) return null;
  const fill =
    meter.level === "high"
      ? "var(--text-danger, #e5484d)"
      : meter.level === "warn"
        ? "var(--text-warning, #d9920a)"
        : "var(--accent-presence)";
  const title = `Context ${meter.percent}% full — ${meter.usedTokens.toLocaleString()} of ${meter.windowTokens.toLocaleString()} tokens${meter.known ? "" : " (window size estimated)"}`;
  return (
    <span className="cave-chat-meta-line__context inline-flex items-center gap-1" title={title}>
      {" · "}
      <span
        aria-hidden
        className="inline-block h-[5px] w-7 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--text-muted)_28%,transparent)]"
      >
        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, meter.percent)}%`, background: fill }} />
      </span>
      <span aria-label={`Context ${meter.percent} percent full`}>{`${meter.percent}%`}</span>
    </span>
  );
}

function UsagePlanChip({ usagePlan }: { usagePlan: ChatUsagePlanSnapshot | null }) {
  // Ultra-minimal header: an "unconfigured" plan is the common, uninformative
  // case — suppress the "No plan limits" chip entirely and only surface the
  // plan when there's an actual limit/usage (or a degraded "unavailable").
  if (!usagePlan || usagePlan.availability === "unconfigured") return null;
  const summary = formatChatUsagePlanSummary(usagePlan);
  if (!summary) return null;
  return (
    <span
      className="cave-chat-meta-line__usage-plan inline-flex items-center gap-1"
      title={chatUsagePlanTooltip(usagePlan) ?? undefined}
    >
      {" · "}
      <Icon name="ph:chart-bar-bold" width={11} aria-hidden />
      <span>{summary}</span>
    </span>
  );
}

/** Single header row: editable title left, harness/model/status meta right.
 *  Ephemeral state (streaming, failed, daemon offline) recolors the line and
 *  rewrites the meta string instead of emitting separate pills/bars. */
function MetaLine({
  session,
  linkedContext,
  busy,
  lifecycle,
  pendingSince,
  error,
  daemonRunning,
  durationMs,
  usage,
  costUsd,
  usagePlan,
  responseMetadata,
  familiar,
  projectRoot,
  onSessionsChanged,
  onBack,
  children,
}: {
  session: SessionRow | null;
  linkedContext: ChatLinkedContext | null;
  busy: boolean;
  lifecycle: ChatTurnLifecycle | null;
  /** createdAt of the in-flight assistant turn — start of the elapsed ticker. */
  pendingSince?: string | null;
  error: boolean;
  daemonRunning: boolean | undefined;
  durationMs: number | undefined;
  usage?: TurnUsage;
  costUsd?: number;
  usagePlan: ChatUsagePlanSnapshot | null;
  responseMetadata?: ChatResponseMetadata;
  familiar: Familiar;
  projectRoot?: string;
  onSessionsChanged?: () => void;
  onBack?: () => void;
  children?: React.ReactNode;
}) {
  const state = metaLineState({ busy, lifecycle, error, daemonRunning });
  // Resolve once: the effective model id drives both the meta segments and the
  // context meter (the meter needs the model to size the window).
  const metaModel =
    responseMetadataModel(responseMetadata) ??
    visibleModelId(session?.model ?? undefined, familiar.harness ?? undefined) ??
    visibleModelId(familiar.model ?? undefined, familiar.harness ?? undefined) ??
    undefined;
  const segments = metaLineSegments({
    state,
    lifecycle,
    harness: familiar.harness ?? undefined,
    model: metaModel,
    runtime: responseMetadata?.runtime ?? session?.runtime,
    projectRoot: session?.project_root ?? projectRoot,
    durationMs,
    usage,
    costUsd,
  });
  const task = linkedContext?.task ?? null;
  // Same defense-in-depth override as the old headline row: hide a raw
  // "Task context: …" seed prompt that leaked through as the title.
  const titleOverride =
    session && task && (session.title ?? "").startsWith("Task context:")
      ? `Task: ${task.title}`
      : null;
  return (
    <div className={`cave-chat-meta-line cave-chat-meta-line--${state}`} role="status" aria-live="polite" data-lifecycle={state}>
      {state !== "complete" ? <span className="cave-chat-meta-line__dot" aria-hidden /> : null}
      {session ? (
        <ChatTitleEditable
          session={session}
          displayTitleOverride={titleOverride}
          onSessionsChanged={onSessionsChanged}
        />
      ) : null}
      <span className="cave-chat-meta-line__meta" title={metaModel ?? undefined}>
        {segments.map((seg, i) => (
          <Fragment key={i}>
            {i > 0 ? " · " : null}
            {typeof seg === "string" ? (
              seg
            ) : (
              <span className="cave-chat-meta-line__dir" title={seg.dir.title}>
                <Icon name="ph:folder" width={11} aria-hidden />
                {seg.dir.label}
              </span>
            )}
          </Fragment>
        ))}
        {state === "streaming" && pendingSince ? <MetaLineElapsed since={pendingSince} /> : null}
        {state === "streaming" ? " · esc to cancel" : null}
        {state === "complete" ? <ContextMeterChip usage={usage} model={metaModel} /> : null}
        {state === "complete" ? <UsagePlanChip usagePlan={usagePlan} /> : null}
      </span>
      {children}
    </div>
  );
}

function TaskChip({
  task,
  onOpenTask,
}: {
  task: NonNullable<ChatLinkedContext["task"]>;
  onOpenTask?: (cardId: string) => void;
}) {
  const base =
    "cave-chat-linked-chip cave-chat-linked-chip--task inline-flex min-w-0 items-center border border-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_9%,transparent)] text-[var(--text-secondary)]";
  const statusLine = [task.status, task.priority].filter(Boolean).join(" · ");
  const accessibleLabel = [task.title, task.status, task.priority].filter(Boolean).join(" ");
  const body = (
    <>
      <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
      <span className="min-w-0 truncate">{task.title}</span>
      {statusLine ? <span className="shrink-0 text-[var(--text-muted)]">{statusLine}</span> : null}
    </>
  );
  return onOpenTask ? (
    <button
      type="button"
      aria-label={accessibleLabel}
      onClick={() => onOpenTask(task.id)}
      title={`Open task: ${task.title}`}
      className={`${base} focus-ring transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_18%,transparent)] hover:text-[var(--text-primary)]`}
    >
      {body}
      <Icon name="ph:arrow-square-out" width={10} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  ) : (
    <span className={base}>{body}</span>
  );
}

function LinkedContextRow({
  linkedContext,
  onOpenTask,
  sessionId,
  onLinkedContextChange,
}: {
  linkedContext: ChatLinkedContext | null;
  onOpenTask?: (cardId: string) => void;
  sessionId?: string | null;
  onLinkedContextChange?: (updater: (prev: ChatLinkedContext | null) => ChatLinkedContext | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const task = linkedContext?.task ?? null;
  const tasks = linkedContext?.tasks ?? (task ? [task] : []);
  const github = linkedContext?.github ?? [];
  const canLink = Boolean(sessionId && onLinkedContextChange);
  if (!task && github.length === 0 && !canLink) return null;

  const linkedIds = new Set(tasks.map((t) => t.id));

  const onAssigned = (card: Card) => {
    const linked = {
      id: card.id,
      title: card.title,
      status: card.status,
      priority: card.priority,
      lifecycle: card.lifecycle,
      labels: card.labels,
      cwd: card.cwd,
      // Carrying the card's project re-scopes the picker the moment a task is
      // linked — the chat belongs in the task's project from then on.
      projectId: card.projectId ?? null,
      notes: card.notes.trim() || null,
    };
    onLinkedContextChange?.((prev) => {
      const baseCtx = prev ?? { task: null, tasks: [], github: [] };
      if (baseCtx.tasks.some((t) => t.id === linked.id)) return baseCtx;
      return { ...baseCtx, task: baseCtx.task ?? linked, tasks: [...baseCtx.tasks, linked] };
    });
  };

  return (
    <div className="cave-chat-linked-context">
      {tasks.map((t) => (
        <TaskChip key={t.id} task={t} onOpenTask={onOpenTask} />
      ))}
      {canLink ? (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            title="Link a task to this chat"
            aria-label="Link a task to this chat"
            className="cave-chat-linked-chip cave-chat-linked-chip--link-task focus-ring inline-flex items-center justify-center border border-dashed border-[var(--border-strong)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--accent-presence)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:plus" width={11} className="shrink-0" />
          </button>
          {pickerOpen && sessionId ? (
            <TaskLinkPicker
              sessionId={sessionId}
              linkedIds={linkedIds}
              onAssigned={onAssigned}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </span>
      ) : null}
      {github.map((item) => {
        const compactLabel = compactGitHubContextLabel(item);
        return (
          <a
            key={item.id}
            href={item.url}
            title={`Open ${githubLabel(item.kind)} on GitHub: ${item.title}`}
            className="cave-chat-linked-chip cave-chat-linked-chip--github inline-flex min-w-0 items-center border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            onClick={(event) => {
              event.preventDefault();
              openExternalUrl(item.url);
            }}
          >
            <Icon name={githubIcon(item.kind)} width={12} className="shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 truncate">{compactLabel}</span>
            {item.state ? <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

// Compact, always-visible linked-task chip for the mobile chat header. The
// task tied to this chat used to live only inside the kebab context menu; on
// mobile it now rides directly in the info header so the affiliation is
// visible without opening a menu. Tapping opens the task on the board.
function MobileHeaderTask({
  task,
  onOpenTask,
}: {
  task: NonNullable<ChatLinkedContext["task"]>;
  onOpenTask?: (cardId: string) => void;
}) {
  const inner = (
    <>
      <Icon name="ph:kanban" width={12} className="cave-mobile-header-task__icon" aria-hidden />
      <span className="cave-mobile-header-task__title">{task.title}</span>
      <span className="cave-mobile-header-task__status">{task.status}</span>
      {onOpenTask ? (
        <Icon name="ph:arrow-square-out" width={11} className="cave-mobile-header-task__open" aria-hidden />
      ) : null}
    </>
  );
  return onOpenTask ? (
    <button
      type="button"
      className="cave-mobile-header-task"
      onClick={() => onOpenTask(task.id)}
      aria-label={`Open linked task: ${task.title}`}
    >
      {inner}
    </button>
  ) : (
    <div className="cave-mobile-header-task" role="note" aria-label={`Linked task: ${task.title}`}>
      {inner}
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
  onOpenDebug,
}: {
  familiar: Familiar;
  session: SessionRow | null;
  linkedContext: ChatLinkedContext | null;
  historyState: ChatHistoryState;
  daemonRunning?: boolean;
  projectRoot?: string;
  onOpenTask?: (cardId: string) => void;
  onOpenDebug?: () => void;
}) {
  const github = linkedContext?.github ?? [];
  const repo = repoName(session?.project_root ?? projectRoot);
  const runtime = [
    familiar.harness,
    visibleModelId(familiar.model ?? undefined, familiar.harness ?? undefined),
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
        {onOpenDebug ? (
          <button type="button" className="cave-mobile-context-link" onClick={onOpenDebug}>
            <Icon name="ph:bug-bold" width={13} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Debug session</span>
          </button>
        ) : null}
        {/* The linked task now rides in the mobile header (MobileHeaderTask),
            so it's intentionally not duplicated here. */}
        {github.length ? (
          <div className="cave-mobile-context-links">
            {github.slice(0, 3).map((item) => (
              <a
                key={item.id}
                href={item.url}
                className="cave-mobile-context-link"
                onClick={(event) => {
                  event.preventDefault();
                  openExternalUrl(item.url);
                }}
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
      <button
        type="button"
        onClick={onAttach}
        disabled={!canAttach || busy}
        className="cave-mobile-action-chip"
        title="Attach images, videos, or files"
      >
        <Icon name="ph:paperclip" width={13} aria-hidden />
        Attach
      </button>
      <button type="button" onClick={onVoice} disabled={!hasSession} className="cave-mobile-action-chip cave-mobile-action-chip--icon" aria-label="Start voice call">
        <Icon name="ph:phone" width={13} aria-hidden />
      </button>
    </div>
  );
}

async function chatBridgeFailureMessage(res: Response): Promise<string> {
  const base = `request failed (${res.status})`;
  let detail = "";
  try {
    const raw = (await res.text()).trim();
    if (raw) {
      try {
        const json = JSON.parse(raw) as { error?: unknown; message?: unknown };
        detail =
          typeof json.error === "string"
            ? json.error
            : typeof json.message === "string"
              ? json.message
              : raw;
      } catch {
        detail = raw;
      }
    }
  } catch {
    // Keep the status-only fallback if the response body cannot be read.
  }
  return detail ? `${base}: ${detail}` : base;
}

// ── ChatView ──────────────────────────────────────────────────────────────────

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { familiar, sessionId, session, projectRoot, initialPrompt, initialAttachments, initialControls, origin, openFindQuery, openFindNonce, daemonRunning, sessions, onSessionStarted, onSessionsChanged, onBack, onSlashCommand, onOpenOnboarding, onOpenTask, onOpenUrl, onProjectRootChange },
  ref,
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string>("");
  // Branching: undefined = no pending branch; null = branch at the ROOT (the
  // edited/regenerated turn was itself a root, so its sibling is also a root);
  // string = branch under that parent turn. The undefined-vs-null distinction
  // is what lets the first exchange branch instead of silently appending.
  const [pendingBranchParent, setPendingBranchParent] = useState<string | null | undefined>(undefined);
  const [historyState, setHistoryState] = useState<ChatHistoryState>("idle");
  const [flowTranscriptFallback, setFlowTranscriptFallback] = useState<string | null>(null);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [reflectError, setReflectError] = useState<string | null>(null);
  const [threadSignalReport, setThreadSignalReport] = useState<ThreadSelfReport | null>(null);
  const flowBackedSession = useMemo(() => isFlowBackedSession(session ?? null), [session]);
  const autoSelfReportSessionsRef = useRef<Set<string>>(new Set());
  const autoSelfReportEligibilityRef = useRef<{ sessionId: string | null; eligible: boolean }>({
    sessionId: null,
    eligible: false,
  });

  // Publish live chat state for the session debug pane (right panel / modal).
  // Per-instance token: a second ChatView (right-panel Chat tab) unmounting
  // must not clear state this instance published after it.
  const debugToken = useMemo(() => Symbol("chat-debug-publisher"), []);
  useEffect(() => {
    publishChatDebugState(debugToken, { sessionId, session: session ?? null, familiar, turns });
  }, [debugToken, sessionId, session, familiar, turns]);
  useEffect(() => () => clearChatDebugState(debugToken), [debugToken]);

  const openDebug = useCallback(() => {
    // lg+ has the right panel; below that, fall back to a modal.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      window.dispatchEvent(new CustomEvent("cave:debug-open"));
    } else {
      setDebugModalOpen(true);
    }
  }, []);

  const reflectOnThread = useCallback(async () => {
    if (!sessionId || reflecting) return;
    setReflecting(true);
    setReflectError(null);
    try {
      // Generate the reflection client-side via the chat bridge — the daemon has
      // no LLM endpoint. Run it ephemerally (embed the transcript instead of
      // resuming the session) so it never appends a turn to the user's thread.
      const prompt = buildThreadReflectPrompt({ sessionId, transcript: buildReflectTranscript(turns) });
      const { text, error } = await streamFamiliarText({ familiarId: familiar.id, prompt });
      if (error) throw new Error(error);
      const res = await fetch(`/api/familiars/${encodeURIComponent(familiar.id)}/self-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          trigger: "manual",
          threadTitle: session?.title ?? familiar.display_name,
          payload: text,
        }),
      });
      const json = await res.json() as { ok: true; report: ThreadSelfReport } | { ok: false; error?: string };
      if (!json.ok) throw new Error(json.error ?? "reflection failed");
      setThreadSignalReport(json.report);
    } catch (err) {
      setReflectError(err instanceof Error ? err.message : "reflection failed");
    } finally {
      setReflecting(false);
    }
  }, [familiar.display_name, familiar.id, reflecting, session?.title, sessionId, turns]);

  const autoReflectOnThread = useCallback(async (targetSessionId: string) => {
    if (!familiar.autoSelfReport) return;
    try {
      const prompt = buildThreadReflectPrompt({ sessionId: targetSessionId, transcript: buildReflectTranscript(turns) });
      const { text, error } = await streamFamiliarText({ familiarId: familiar.id, prompt });
      if (error || !text.trim()) return;
      const res = await fetch(`/api/familiars/${encodeURIComponent(familiar.id)}/self-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: targetSessionId,
          trigger: "auto",
          threadTitle: session?.title ?? familiar.display_name,
          payload: text,
        }),
      });
      const json = await res.json().catch(() => null) as
        | { ok: true; report: ThreadSelfReport }
        | { ok: false; error?: string }
        | null;
      if (json?.ok) setThreadSignalReport(json.report);
    } catch {
      /* Auto self-report is best-effort and intentionally silent. */
    }
  }, [familiar.autoSelfReport, familiar.display_name, familiar.id, session?.title, turns]);

  useEffect(() => {
    const status = session?.status?.toLowerCase();
    const eligible = Boolean(
      session?.archived_at ||
      status === "closed" ||
      status === "completed" ||
      status === "complete" ||
      status === "done" ||
      status === "stopped",
    );
    const previous = autoSelfReportEligibilityRef.current;
    const reachedClosedState = previous.sessionId === sessionId && !previous.eligible && eligible;
    autoSelfReportEligibilityRef.current = { sessionId, eligible };
    if (!sessionId || !reachedClosedState || !familiar.autoSelfReport) return;
    if (autoSelfReportSessionsRef.current.has(sessionId)) return;
    autoSelfReportSessionsRef.current.add(sessionId);
    void autoReflectOnThread(sessionId);
  }, [autoReflectOnThread, familiar.autoSelfReport, session?.archived_at, session?.status, sessionId]);

  useEffect(() => {
    setThreadSignalReport(null);
    setReflectError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!reflectError) return;
    const timer = window.setTimeout(() => setReflectError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [reflectError]);

  const [historyRetryKey, setHistoryRetryKey] = useState(0);
  const retryHistory = useCallback(() => setHistoryRetryKey((k) => k + 1), []);
  const [linkedContext, setLinkedContext] = useState<ChatLinkedContext | null>(null);
  const { announce } = useAnnouncer();
  // "Start a task" (card-follows-chat): the starting page arms this, and the
  // stream's "session" event — where the session id is born — creates the
  // linked board card from the first prompt. State renders the armed chip; the
  // ref is what handleEvent reads mid-stream (one-shot, cleared on fire).
  const [taskArmed, setTaskArmed] = useState(false);
  const taskArmedRef = useRef(false);
  const armTask = () => {
    taskArmedRef.current = true;
    setTaskArmed(true);
    inputRef.current?.focus();
  };
  const disarmTask = () => {
    taskArmedRef.current = false;
    setTaskArmed(false);
  };
  // In-chat "final nudge" — surfaces when the linked task hits `completed`
  // lifecycle. Dismiss is persisted per-session in localStorage so the banner
  // doesn't reappear on every reload after the user waved it off.
  const [archiveNudgeDismissed, setArchiveNudgeDismissed] = useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : isChatArchiveNudgeDismissed(sessionId ?? "", window.localStorage),
  );
  const [archivingChat, setArchivingChat] = useState(false);
  const [modelState, setModelState] = useState<ChatModelState | null>(null);
  const [usagePlan, setUsagePlan] = useState<ChatUsagePlanSnapshot | null>(null);
  const [thinkingEffort, setThinkingEffort] = useState<ComposerThinkingEffort>(() => readComposerPrefs().thinkingEffort);
  const [responseSpeed, setResponseSpeed] = useState<ComposerResponseSpeed>(() => readComposerPrefs().responseSpeed);
  const [permissionMode, setPermissionMode] = useState<CommandPermissionMode>(() => readComposerPrefs().permissionMode);
  // Composer Host chip: null = auto — the conversation's recorded host, else
  // the familiar's own runtime binding. Only an explicit pick rides the send
  // body (deliberately per-session, not a sticky global pref: a forgotten
  // sticky remote host would silently run every new chat elsewhere).
  const [runtimeHost, setRuntimeHost] = useState<string | null>(null);
  const sessionRuntimeHost = useMemo(() => {
    const parsed = parseConversationRuntime(session?.runtime);
    return parsed?.kind === "ssh" ? parsed.host : null;
  }, [session?.runtime]);
  const composerHostValue = runtimeHost ?? sessionRuntimeHost ?? LOCAL_HOST_ID;
  const [input, setInput] = useState(() => readComposerDraft());
  // CHAT-D11-04: Input history navigation (↑↓), matching HomeComposer pattern
  const [inputHistory, setInputHistory] = useState<string[]>(() => readComposerHistory(COMPOSER_HISTORY_KEY));
  const [inputHistoryIdx, setInputHistoryIdx] = useState<number>(-1);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // Reply to Chat: the turn the next message quotes, shown as a composer chip
  // and prepended as a markdown blockquote to the outgoing prompt at send time.
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debug context for the inline error strip below the chat: which turn failed
  // and an optional machine code. `seq` increments per occurrence so the strip
  // re-expands its detail every time a *new* error fires (not just the first).
  const [debugError, setDebugError] = useState<{ seq: number; turnId?: string; code?: string } | null>(null);
  const debugErrorSeqRef = useRef(0);
  const raiseDebugError = useCallback((ctx: { turnId?: string; code?: string }) => {
    debugErrorSeqRef.current += 1;
    setDebugError({ seq: debugErrorSeqRef.current, ...ctx });
  }, []);
  const [lastFailedSend, setLastFailedSend] = useState<FailedSend | null>(null);
  // The working directory of a send that failed the 403 project-access check —
  // a chat whose cwd sits outside every registered project the familiar can
  // reach. Drives the error strip's "Add project" recovery action.
  const [projectAccessRoot, setProjectAccessRoot] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [expandedAvatarTurnId, setExpandedAvatarTurnId] = useState<string | null>(null);
  const expandedAvatarTurnIdRef = useRef<string | null>(null);
  expandedAvatarTurnIdRef.current = expandedAvatarTurnId;
  // Two-step delete via the header trash button: it opens a confirm popover and
  // only the explicit Delete commits (HeaderDeleteButton owns the armed state).
  const [deleting, setDeleting] = useState(false);
  const { projects, createProject, reload: reloadProjects } = useProjects();
  const firstProject = projects[0] ?? null;
  const [projectIdDraft, setProjectIdDraft] = useState<string | null>(null);
  // A session whose recorded cwd maps to no registered project resolves to
  // NO_PROJECT_ID here — never to the first project, whose root would re-root
  // the next turn's cwd and fork the harness session (`--continue` misses).
  // A linked task's project (card projectId/cwd) outranks the recorded cwd: a
  // chat tied to a task opens in — and runs in — the task's project.
  const projectSelection = resolveChatProjectSelection({
    draftId: projectIdDraft,
    hasSession: Boolean(session),
    sessionProjectRoot: session?.project_root,
    fallbackProjectRoot: projectRoot,
    taskProjectId: linkedContext?.task?.projectId,
    taskCwd: linkedContext?.task?.cwd,
    projects,
  });
  const resolvedProjectId = projectSelection.projectId;
  const selectedProject = projectSelection.project;
  const activeProjectRoot =
    resolvedProjectId === NO_PROJECT_ID ? "" : (selectedProject?.root ?? session?.project_root ?? projectRoot ?? "");
  // Root asserted to the server on send. A session's recorded cwd is NOT an
  // explicit project choice: a no-project chat boots in the familiar's own
  // workspace and the daemon records that dir as project_root. Echoing it back
  // as projectRoot makes the server treat the next turn as an
  // unregistered-project request and fail closed (403 "project access
  // denied"). Only assert a root that maps to a registered project or came
  // from an explicit selection; the server derives the resume cwd from the
  // conversation record when no root rides.
  const requestProjectRoot =
    activeProjectRoot &&
    activeProjectRoot === session?.project_root &&
    (resolvedProjectId === NO_PROJECT_ID || !projectIdForRoot(activeProjectRoot, projects))
      ? ""
      : activeProjectRoot;
  // Shared add-project flow for the overflow menu: register + grant in one
  // click, then make the new project this chat's next-send selection.
  const overflowAddProject = useAddProjectFlow({
    familiarId: familiar?.id ?? null,
    createProject,
    projects,
    onAdded: (newProjectId) => {
      setProjectIdDraft(newProjectId);
      reloadProjects();
    },
  });
  useEffect(() => {
    onProjectRootChange?.(activeProjectRoot || null);
  }, [activeProjectRoot, onProjectRootChange]);
  // Drag-and-drop attach (CHAT-D1-03). The counter tracks nested
  // dragenter/dragleave pairs so transitions across child elements don't
  // flicker the overlay; only file drags (dataTransfer.types includes
  // "Files") arm it, so dragging a text selection never hijacks the surface.
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const currentSessionRef = useRef<string | null>(sessionId);
  const liveSessionIdRef = useRef<string | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll-pin state (CHAT-D10-01). `following` means "keep the transcript
  // pinned to the newest content". It releases on user INTENT (wheel up /
  // touch drag toward earlier content), never on mere scroll position — the
  // old position-threshold release meant the stream's own smooth-scroll
  // animation kept re-arming the pin and yanked readers back per SSE chunk.
  // The ref mirrors the state so passive DOM listeners and rAF callbacks
  // read the live value without re-subscribing.
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const [newTurnsCount, setNewTurnsCount] = useState(0);
  // Transcript render cap (see TRANSCRIPT_RENDER_CAP). Sticky for the session:
  // once the reader leaves the bottom we mount the whole transcript and keep it
  // mounted, so re-pinning doesn't churn rows in/out.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const historyExpandedRef = useRef(false);
  historyExpandedRef.current = historyExpanded;
  // Distance-from-bottom captured at the instant of expansion so the prepended
  // older rows don't visually shove the viewport (restored in a layout effect).
  const expandAnchorRef = useRef<number | null>(null);
  const updateFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowing(next);
    if (next) {
      // Reset count when returning to the bottom
      setNewTurnsCount(0);
    } else if (!historyExpandedRef.current) {
      // Leaving the bottom (wheel/touch/keys/find-jump all funnel here) — mount
      // the full transcript and anchor the scroll so older rows slide in above
      // the current view instead of jumping it.
      const el = scrollRef.current;
      expandAnchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setHistoryExpanded(true);
    }
  }, []);

  // Restore the pre-expansion distance-from-bottom once the full transcript has
  // mounted, so revealing the older rows doesn't jump the reader's viewport.
  useLayoutEffect(() => {
    if (!historyExpanded) return;
    const anchor = expandAnchorRef.current;
    expandAnchorRef.current = null;
    if (anchor == null) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, el.scrollHeight - anchor);
  }, [historyExpanded]);

  const refreshModelState = useCallback(async (): Promise<ChatModelState | null> => {
    const params = new URLSearchParams({ familiarId: familiar.id });
    if (sessionId) params.set("sessionId", sessionId);
    try {
      const res = await fetch(`/api/chat/model-state?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
      const next = json.ok && json.state ? json.state : null;
      setModelState(next);
      return next;
    } catch {
      setModelState(null);
      return null;
    }
  }, [familiar.id, sessionId]);

  const refreshUsagePlan = useCallback(
    async (modelOverride?: string | null): Promise<ChatUsagePlanSnapshot | null> => {
      const params = new URLSearchParams({ familiarId: familiar.id });
      if (sessionId) params.set("sessionId", sessionId);
      const model =
        modelOverride ??
        (modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
          ? modelState.effectiveModel
          : visibleModelId(session?.model ?? familiar.model ?? undefined, familiar.harness ?? undefined));
      if (model) params.set("model", model);
      try {
        const res = await fetch(`/api/chat/usage?${params.toString()}`, { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; snapshot?: ChatUsagePlanSnapshot };
        const next = json.ok && json.snapshot ? json.snapshot : null;
        setUsagePlan(next);
        return next;
      } catch {
        setUsagePlan(null);
        return null;
      }
    },
    [familiar.harness, familiar.id, familiar.model, modelState?.effectiveModel, session?.model, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refreshModelState();
      // refreshModelState already set state; guard only against a stale familiar
      // swap landing after unmount/re-fetch.
      if (cancelled && next) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshModelState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refreshUsagePlan();
      if (cancelled && next) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUsagePlan]);

  useEffect(() => {
    writeComposerPrefs({ thinkingEffort, responseSpeed, permissionMode });
  }, [thinkingEffort, responseSpeed, permissionMode]);

  // Persist a model choice through the existing channels: session scope when a
  // chat exists (writes the conversation's modelIntent), else familiar-default.
  // No new persistence path — the picker reuses /api/chat/model-state.
  const handleSelectModel = useCallback(
    (modelId: string) => {
      void (async () => {
        try {
          const res = await fetch("/api/chat/model-state", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiarId: familiar.id,
              sessionId: sessionId ?? undefined,
              model: modelId,
              scope: sessionId ? "session" : "familiar-default",
            }),
          });
          const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
          if (json.ok && json.state) setModelState(json.state);
          else await refreshModelState();
        } catch {
          await refreshModelState();
        }
      })();
    },
    [familiar.id, sessionId, refreshModelState],
  );
  const pinFrameRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSlashOptionRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Keys for POST /api/chat/stop — a deliberate Stop must be an explicit
   *  server call; a bare fetch abort now reads as a transport drop and the
   *  turn finishes server-side. runId targets a run this instance started
   *  (works before the server assigns a session id); sessionId covers
   *  adopted streams (remount mid-generation) where the runId is unknown. */
  const stopKeysRef = useRef<{ runId: string | null; sessionId: string | null }>({
    runId: null,
    sessionId: null,
  });
  const initialPromptSentRef = useRef(false);
  /** True while THIS instance's sendRaw reader loop is running. The owner
   *  applies stream events itself (handleEvent), so it never needs the
   *  settle-refetch below; an instance that merely ADOPTED a live snapshot
   *  (remounted mid-generation) does. */
  const streamOwnerRef = useRef(false);
  /** Session whose settle (registry clear) should trigger a disk refetch:
   *  set when this non-owner view adopts a live snapshot, or when it evicts
   *  a stale one while the orphaned stream may still be running (cave-0er). */
  const refetchOnSettleRef = useRef<string | null>(null);
  /** Count of registry null-notifications to swallow: evicting a stale
   *  snapshot emits one, and that self-inflicted settle must not refetch a
   *  conversation the history effect is already loading. */
  const skipSettleNotifyRef = useRef(0);
  const keys = useKeySymbols();

  function persistLiveTurns(
    nextTurns: Turn[],
    nextActiveLeafId: string,
    controller: AbortController | null = abortRef.current,
    targetSessionId: string | null = currentSessionRef.current,
  ) {
    const liveSessionId = targetSessionId;
    if (!liveSessionId || !controller) return;
    recordLiveChatGeneration({
      sessionId: liveSessionId,
      controller,
      turns: nextTurns,
      activeLeafId: nextActiveLeafId,
      updatedAt: Date.now(),
    });
  }

  function updateLiveTurns(
    updater: (prev: Turn[]) => Turn[],
    nextActiveLeafId: string,
    controller: AbortController | null = abortRef.current,
    targetSessionId: string | null = currentSessionRef.current,
  ) {
    // Registry-first (cave-0er): while a generation has a registry snapshot,
    // the registry is the accumulating source of truth — it lives at module
    // scope, so chunks keep landing even after this component instance
    // unmounts (navigating to another surface). Routing accumulation through
    // setTurns instead silently dropped every post-unmount update (React
    // ignores setState on unmounted instances), freezing the snapshot and
    // losing the response.
    if (targetSessionId) {
      const stored = liveChatRegistry.advance(targetSessionId, updater, nextActiveLeafId);
      if (stored) {
        // Mirror synchronously into THIS view's state when it is showing the
        // streaming session. Reusing the stored array means the microtask
        // notification delivers the same reference — setTurns bails, no
        // double render. A view on a different thread ignores the update; an
        // unmounted view's setTurns is a harmless no-op (the registry
        // already has the data and a remount adopts it).
        if (targetSessionId === currentSessionRef.current) {
          turnsRef.current = stored.turns;
          setTurns(stored.turns);
        }
        return;
      }
      // Stream already settled / snapshot evicted: drop background updates
      // aimed at a thread that is not on screen.
      if (targetSessionId !== currentSessionRef.current) return;
    }
    // No registry snapshot (e.g. a brand-new chat before its "session" event
    // assigns an id): plain component state, exactly as before.
    setTurns((prev) => {
      const next = updater(prev);
      turnsRef.current = next;
      persistLiveTurns(next, nextActiveLeafId, controller, targetSessionId);
      return next;
    });
  }

  useEffect(() => {
    if (!sessionId) return;
    return subscribeLiveChatGeneration(sessionId, (live) => {
      if (live && isLiveSnapshotActive(live, Date.now())) {
        setTurns(live.turns);
        turnsRef.current = live.turns;
        setActiveLeafId(live.activeLeafId);
        abortRef.current = live.controller;
        setHistoryState("loaded");
        setBusy(true);
        // Adopted someone else's stream (this instance mounted mid-
        // generation): reconcile from disk when it settles, because this
        // view never sees the stream's "done" event and the optimistic
        // snapshot lacks the persisted turn ids/usage.
        if (!streamOwnerRef.current) refetchOnSettleRef.current = sessionId;
        return;
      }
      abortRef.current = null;
      setBusy(false);
      if (!live && skipSettleNotifyRef.current > 0) {
        skipSettleNotifyRef.current -= 1;
        return;
      }
      // Settle (registry cleared) for a generation this view adopted but
      // does not own: the server has now persisted the full exchange (or a
      // cancel marker) — reload the conversation from disk so the completed
      // response actually appears (cave-0er). The owner skips this: its own
      // handleEvent already applied the final state.
      if (!live && refetchOnSettleRef.current === sessionId && !streamOwnerRef.current) {
        refetchOnSettleRef.current = null;
        setHistoryRetryKey((k) => k + 1);
      }
    });
  }, [sessionId]);

  // ── In-transcript find (CHAT-D9-04) ────────────────────────────────────
  // Turn-level find: case-insensitive substring over each turn's VISIBLE
  // text. `m` counts matching TURNS (honest scope — intra-turn highlighting
  // inside sanitized rendered HTML is deferred render-pipeline surgery).
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findDebouncedQuery, setFindDebouncedQuery] = useState("");
  const [findActiveIdx, setFindActiveIdx] = useState(0);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  // Turn id flashed with the cave-turn-found highlight after a jump.
  const [foundTurnId, setFoundTurnId] = useState<string | null>(null);
  const foundClearTimerRef = useRef<number | null>(null);
  const foundFrameRef = useRef<number | null>(null);
  const lastJumpedQueryRef = useRef("");

  const clearFoundHighlightTimer = useCallback(() => {
    if (foundFrameRef.current !== null) {
      window.cancelAnimationFrame(foundFrameRef.current);
      foundFrameRef.current = null;
    }
    if (foundClearTimerRef.current !== null) {
      window.clearTimeout(foundClearTimerRef.current);
      foundClearTimerRef.current = null;
    }
  }, []);

  // Debounce the query ~150ms so matching doesn't churn per keystroke.
  useEffect(() => {
    if (!findOpen) return;
    const timer = window.setTimeout(() => setFindDebouncedQuery(findQuery), 150);
    return () => window.clearTimeout(timer);
  }, [findOpen, findQuery]);

  // Recompute on (debounced) query change AND on turns change while open —
  // a streaming chunk can create or grow a matching turn.
  const findMatches = useMemo(() => {
    if (!findOpen) return [];
    return findMatchingTurnIds(
      turns.map((t) => ({
        id: t.id,
        // Visible text only: assistant turns may carry inline <thinking>
        // blocks in `text`; match what the transcript actually renders.
        text: t.role === "assistant" ? splitReasoning(t.text).visible : t.text,
      })),
      findDebouncedQuery,
    );
  }, [findOpen, findDebouncedQuery, turns]);

  // Find searches the whole transcript, so opening it mounts every turn — a
  // jump (jumpToFindMatch) resolves its target via querySelector and must find
  // the row in the DOM regardless of the render cap.
  useEffect(() => {
    if (findOpen) setHistoryExpanded(true);
  }, [findOpen]);

  // Keep the active pointer in bounds when the match set shrinks.
  useEffect(() => {
    setFindActiveIdx((i) => (findMatches.length === 0 ? 0 : Math.min(i, findMatches.length - 1)));
  }, [findMatches]);

  const jumpToFindMatch = useCallback(
    (idx: number, matches: string[]) => {
      const id = matches[idx];
      if (!id) return;
      setFindActiveIdx(idx);
      // A find jump is explicit navigation away from the tail — release the
      // stream follow-pin (CHAT-D10-01) so the next SSE chunk doesn't yank
      // the reader back to the bottom.
      if (followingRef.current) updateFollowing(false);
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-turn-id="${CSS.escape(id)}"]`,
      );
      // Always instant: the pin/release machinery owns smooth behavior, and
      // "auto" is reduced-motion-safe without a matchMedia branch.
      el?.scrollIntoView({ block: "center", behavior: "auto" });
      // Restart the 1.5s highlight fade even when re-landing on the same
      // turn: clear, then re-set on the next frame so the class re-applies.
      clearFoundHighlightTimer();
      setFoundTurnId(null);
      foundFrameRef.current = requestAnimationFrame(() => {
        setFoundTurnId(id);
        foundFrameRef.current = null;
      });
      foundClearTimerRef.current = window.setTimeout(() => {
        setFoundTurnId(null);
        foundClearTimerRef.current = null;
      }, 1500);
    },
    [clearFoundHighlightTimer, updateFollowing],
  );

  useEffect(() => () => clearFoundHighlightTimer(), [clearFoundHighlightTimer]);

  // A fresh (debounced) query jumps to its first matching turn. Guarded by
  // ref so turns-driven recomputes (e.g. streaming) never re-trigger a jump.
  useEffect(() => {
    if (!findOpen) return;
    if (findDebouncedQuery === lastJumpedQueryRef.current) return;
    lastJumpedQueryRef.current = findDebouncedQuery;
    if (findMatches.length > 0) jumpToFindMatch(0, findMatches);
    else setFindActiveIdx(0);
  }, [findOpen, findDebouncedQuery, findMatches, jumpToFindMatch]);

  const findNext = useCallback(() => {
    if (findMatches.length === 0) return;
    jumpToFindMatch((findActiveIdx + 1) % findMatches.length, findMatches);
  }, [findActiveIdx, findMatches, jumpToFindMatch]);

  const findPrev = useCallback(() => {
    if (findMatches.length === 0) return;
    jumpToFindMatch((findActiveIdx - 1 + findMatches.length) % findMatches.length, findMatches);
  }, [findActiveIdx, findMatches, jumpToFindMatch]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setFindFocusNonce((n) => n + 1);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindDebouncedQuery("");
    lastJumpedQueryRef.current = "";
    setFindActiveIdx(0);
    clearFoundHighlightTimer();
    setFoundTurnId(null);
    // Esc hands focus back to the composer.
    inputRef.current?.focus();
  }, [clearFoundHighlightTimer]);

  // Reset find when switching sessions — match indices are per-transcript.
  useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindDebouncedQuery("");
    lastJumpedQueryRef.current = "";
    setFindActiveIdx(0);
    clearFoundHighlightTimer();
    setFoundTurnId(null);
  }, [clearFoundHighlightTimer, sessionId]);

  // Open in-thread find on a query handed in from a ⌘K Conversations hit. Keyed
  // on the nonce so it fires once per request, and declared AFTER the session
  // reset above so it wins when both run on the same session switch. The find
  // effect then auto-scrolls to the first match once the transcript loads.
  const openFindNonceRef = useRef(0);
  useEffect(() => {
    if (!openFindNonce || openFindNonce === openFindNonceRef.current) return;
    openFindNonceRef.current = openFindNonce;
    const q = (openFindQuery ?? "").trim();
    if (!q) return;
    setFindOpen(true);
    setFindQuery(q);
  }, [openFindNonce, openFindQuery]);

  // ⌘F/Ctrl+F is scoped to the chat section via this React keydown handler
  // on the section root — NOT a window-level listener — so ChatList's ⌘F
  // (session search) and browser-native find elsewhere keep working.
  const onChatSectionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        // Stop the event short of window so a co-mounted ChatList (its ⌘F
        // session-search listener lives on window) can't steal focus while
        // the user is finding inside this chat.
        e.stopPropagation();
        openFind();
      }
      if (e.key === "Escape" && expandedAvatarTurnIdRef.current) {
        setExpandedAvatarTurnId(null);
      }
    },
    [openFind],
  );

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
  const slashMatches: SlashCommand[] = useMemo(() => {
    const firstWord = input.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || input.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [input]);
  const [slashIdx, setSlashIdx] = useState(0);
  // Esc hides the menu for the current input; any edit brings it back.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashSuggestions: SlashCommand[] = slashDismissed ? [] : slashMatches;
  // Skills for the inline `/skill` / `/skills` picker — fetched once from the
  // local skill scan (Coven skills + ~/.claude/skills).
  const [skills, setSkills] = useState<SkillOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/skills/local", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.skills)) setSkills(j.skills as SkillOption[]);
      })
      .catch(() => {
        /* offline → no inline skill picker (the command menu still works) */
      });
    return () => {
      alive = false;
    };
  }, []);
  // Prompt templates for the `/prompt` / `/prompts` picker and the Prompt
  // snippets modal. Seeded with the built-ins so the picker works instantly
  // (and offline); the fetch layers in ~/.coven/prompts files and installed
  // marketplace prompt packs.
  const [prompts, setPrompts] = useState<PromptOption[]>(BUILTIN_PROMPTS);
  const [promptSnippetsOpen, setPromptSnippetsOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/prompts", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.prompts)) setPrompts(j.prompts as PromptOption[]);
      })
      .catch(() => {
        /* offline → built-in templates only */
      });
    return () => {
      alive = false;
    };
  }, []);
  // While typing "/model <partial>", the menu shows model options instead of
  // commands (an inline picker). null ⇒ not in /model arg position.
  const modelHarness = modelState?.harness ?? familiar.harness ?? "claude";
  const modelOptions = useMemo(
    () => (slashDismissed ? null : modelSlashOptions(input, modelHarness)),
    [input, modelHarness, slashDismissed],
  );
  // Stable model menu for the composer chip (independent of the /model
  // autocomplete above, which is null outside `/model <arg>` position).
  const composerModelOptions = useMemo(
    () => catalogForRuntime(modelHarness)?.models ?? [],
    [modelHarness],
  );
  const composerModelValue =
    modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
      ? modelState.effectiveModel
      : composerModelOptions[0]?.id ?? "";
  const modelMenuActive = (modelOptions?.length ?? 0) > 0;
  // Inline `/skill` / `/skills` picker — null ⇒ not in a skill-picker position.
  const skillOptions = useMemo(
    () => (slashDismissed ? null : skillSlashOptions(input, skills)),
    [input, skills, slashDismissed],
  );
  const skillMenuActive = (skillOptions?.length ?? 0) > 0;
  // Inline `/prompt` / `/prompts` picker — null ⇒ not in a prompt-picker position.
  const promptOptions = useMemo(
    () => (slashDismissed ? null : promptSlashOptions(input, prompts)),
    [input, prompts, slashDismissed],
  );
  const promptMenuActive = (promptOptions?.length ?? 0) > 0;
  // Skills surfaced directly in the command menu — typing `/revi` finds the
  // code-review skill without the /skill prefix. Same first-token-only rule as
  // slashMatches so arg positions never double-render.
  const skillCommandRows: SkillOption[] = useMemo(() => {
    if (slashDismissed) return [];
    const t = input.trimStart();
    const firstWord = t.split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || t.includes(" ")) return [];
    return skillCommandMatches(firstWord, skills);
  }, [input, skills, slashDismissed]);
  // The slash-command, /model, /skill and /prompt pickers are mutually
  // exclusive inline listboxes sharing one listbox id, so the composer's
  // combobox ARIA tracks whichever is open.
  const menuOpen = modelMenuActive || skillMenuActive || promptMenuActive || slashSuggestions.length > 0 || skillCommandRows.length > 0;
  // Stable per-mount listbox id — the home composer mounts its own slash menu,
  // so ids must be unique across simultaneously mounted composers.
  const slashListboxId = useId();

  // @-file mentions (CHAT-D1-04). Typing `@` opens a workspace-file picker
  // for the selected predetermined project. The file index is fetched once
  // per root from /api/project/files and fuzzy-filtered client-side. Mentions
  // stay disjoint from the slash menu: `@` is mid-token, `/` first-token-only.
  const mentionRoot = activeProjectRoot.trim();
  const [composerCaret, setComposerCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  // Esc hides the picker for the current input; any edit brings it back.
  const [mentionDismissed, setMentionDismissed] = useState(false);
  // Paths the user picked this draft — sent alongside the prompt so the
  // server can hand the harness resolvable absolute paths.
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);
  const [enhanceStatus, setEnhanceStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [enhanceOriginal, setEnhanceOriginal] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<{ root: string; repo: boolean; files: string[] } | null>(null);
  const mentionListboxId = useId();
  const activeMentionOptionRef = useRef<HTMLButtonElement | null>(null);

  const mentionToken = useMemo(
    () => (mentionRoot ? fileMentionToken(input, composerCaret) : null),
    [input, composerCaret, mentionRoot],
  );
  const mentionMatches: string[] = useMemo(() => {
    if (!mentionToken || mentionDismissed) return [];
    if (!mentionIndex || mentionIndex.root !== mentionRoot || !mentionIndex.repo) return [];
    return filterFileMentions(mentionIndex.files, mentionToken.query, FILE_MENTION_RESULT_LIMIT);
  }, [mentionToken, mentionDismissed, mentionIndex, mentionRoot]);
  const mentionOpen = mentionMatches.length > 0;
  const mentionActiveIdx = mentionOpen ? Math.min(mentionIdx, mentionMatches.length - 1) : 0;
  // The mention picker shares the composer combobox with the slash menu but
  // the two can never open together (`@` is mid-token, `/` first-token-only),
  // so while the picker IS open these override the closed slash menu's ARIA
  // wiring (later JSX attributes win; AriaAttributes keys are optional so the
  // override spread typechecks).
  const mentionAriaOverrides: React.AriaAttributes = mentionOpen
    ? {
        "aria-expanded": true,
        "aria-controls": mentionListboxId,
        "aria-activedescendant": `${mentionListboxId}-opt-${mentionActiveIdx}`,
      }
    : {};

  // Lazy index fetch: first `@` for a given root loads it; the API's own
  // short-lived cache absorbs re-opens across composer instances.
  useEffect(() => {
    if (!mentionToken || !mentionRoot) return;
    if (mentionIndex?.root === mentionRoot) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ root: mentionRoot, familiarId: familiar.id });
        const res = await fetch(`/api/project/files?${params.toString()}`, { cache: "no-store" });
        const json = await res.json() as { ok?: boolean; repo?: boolean; files?: string[] };
        if (cancelled) return;
        setMentionIndex({
          root: mentionRoot,
          repo: json.ok === true && json.repo === true,
          files: Array.isArray(json.files) ? json.files : [],
        });
      } catch {
        if (!cancelled) setMentionIndex({ root: mentionRoot, repo: false, files: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionToken, mentionRoot, mentionIndex, familiar.id]);

  // Insert the picked path inline, replacing the `@query` token (Claude Code
  // convention: `@src/foo.ts`), and record it for the send body.
  const selectMention = (relPath: string) => {
    if (!mentionToken) return;
    const insert = `@${relPath} `;
    const next = input.slice(0, mentionToken.start) + insert + input.slice(composerCaret);
    const nextCaret = mentionToken.start + insert.length;
    setInput(next);
    setComposerCaret(nextCaret);
    setMentionedFiles((prev) =>
      (prev.includes(relPath) ? prev : [...prev, relPath]).slice(0, MAX_FILE_MENTIONS),
    );
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const syncComposerCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setComposerCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
  };
  // In-flight assistant turn drives the MetaLine's live state: its lifecycle
  // picks the phase wording and its createdAt anchors the elapsed ticker
  // (CHAT-D3-06).
  const activePendingTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.role === "assistant" && turn.pending),
    [turns],
  );
  const activeLifecycle = activePendingTurn?.lifecycle ?? (busy ? "connecting" : null);
  // Latest settled assistant turn feeds the MetaLine's complete-state
  // one-liner: duration plus token usage / cost (CHAT-D12-02).
  const lastSettledAssistantTurn = useMemo(
    () =>
      [...turns]
        .reverse()
        .find(
          (t) =>
            t.role === "assistant" &&
            !t.pending &&
            (typeof t.durationMs === "number" || t.usage !== undefined || typeof t.costUsd === "number"),
        ),
    [turns],
  );

  // Active branch path: when activeLeafId is set (branched conversation), only
  // the turns on the path from the root to that leaf are rendered. For linear
  // (non-branched) conversations every turn has exactly one child so
  // resolveActivePath returns the full list — behaviour is identical.
  const activePath = useMemo<Turn[]>(() => {
    if (!activeLeafId) return turns;
    return resolveActivePath(turns, activeLeafId) as Turn[];
  }, [turns, activeLeafId]);

  // Branch-nav siblings for EVERY turn, built once per `turns` change instead
  // of scanning the whole array per rendered row (which ran on every stream
  // chunk). Lookups are O(1).
  const siblingIndex = useMemo(() => buildSiblingIndex(turns), [turns]);
  const siblingsFor = useCallback(
    (turnId: string) => siblingIndex.get(turnId) ?? { siblings: [] as Turn[], index: 0 },
    [siblingIndex],
  );

  // Voice-call grouping + a turn.id → index map for the timestamp-gap logic.
  // Memoized on `activePath` so it's rebuilt only when the visible transcript
  // changes — NOT on every composer keystroke / caret move / hover, which all
  // re-render ChatView but leave `turns` untouched (this was an O(n) rebuild
  // per render).
  const { groupedTurns, turnIndexMap } = useMemo(() => {
    type VoiceGroup = { kind: "call"; callId: string; turns: Turn[]; durationSec: number };
    type SingleItem = { kind: "single"; turn: Turn };
    const grouped: Array<VoiceGroup | SingleItem> = [];
    for (const turn of activePath) {
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
    const turnIndexMap = new Map<string, number>();
    for (let idx = 0; idx < activePath.length; idx++) turnIndexMap.set(activePath[idx].id, idx);
    return { groupedTurns: grouped, turnIndexMap };
  }, [activePath]);

  useEffect(() => {
    setSlashIdx(0);
    setSlashDismissed(false);
    setMentionIdx(0);
    setMentionDismissed(false);
  }, [input]);

  useEffect(() => {
    if (slashSuggestions.length === 0 && skillCommandRows.length === 0) return;
    activeSlashOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [slashIdx, slashSuggestions.length, skillCommandRows.length]);

  useEffect(() => {
    if (mentionMatches.length === 0) return;
    setMentionIdx((i) => (mentionMatches.length === 0 ? 0 : Math.min(i, mentionMatches.length - 1)));
  }, [mentionMatches.length]);

  useEffect(() => {
    if (mentionMatches.length === 0) return;
    activeMentionOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [mentionActiveIdx, mentionMatches.length]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Load history on attach; new chats open with a clean empty state
  useEffect(() => {
    const keepLiveSession = () =>
      shouldKeepLiveNewChatState({
        sessionId,
        currentSessionId: currentSessionRef.current,
        liveSessionId: liveSessionIdRef.current,
        turnCount: turnsRef.current.length,
      });

    if (shouldKeepLiveNewChatState({
      sessionId,
      currentSessionId: currentSessionRef.current,
      liveSessionId: liveSessionIdRef.current,
      turnCount: turnsRef.current.length,
    })) {
      setHistoryState("loaded");
      return;
    }
    currentSessionRef.current = sessionId;
    liveSessionIdRef.current = null;
    // Reset the settle-refetch marker on every (re)load; the live-snapshot
    // branches below re-arm it when there is actually an adopted or possibly-
    // orphaned stream to reconcile. A marker left armed after a normal disk
    // load would fire a spurious reload after the NEXT send settles.
    refetchOnSettleRef.current = null;
    // Thread switch: release streaming state owned by the PREVIOUS thread so its
    // busy lock / Esc-cancel don't bleed onto this one. A background stream
    // keeps running via its registry snapshot + controller; the live-snapshot
    // branch below re-arms busy/abortRef if THIS thread is the one streaming.
    setBusy(false);
    abortRef.current = null;
    stopKeysRef.current = { runId: null, sessionId: null };
    setLinkedContext(null);
    // An armed "Start a task" belongs to the thread it was armed on.
    taskArmedRef.current = false;
    setTaskArmed(false);
    setFlowTranscriptFallback(null);
    if (!sessionId) {
      setTurns([]);
      setActiveLeafId("");
      setHistoryState("idle");
      return;
    }
    const live = readLiveChatGeneration(sessionId);
    if (live && isLiveSnapshotActive(live, Date.now())) {
      setTurns(live.turns);
      turnsRef.current = live.turns;
      setActiveLeafId(live.activeLeafId);
      setFlowTranscriptFallback(null);
      abortRef.current = live.controller;
      stopKeysRef.current = { runId: null, sessionId };
      setHistoryState("loaded");
      setBusy(true);
      // Adopting a stream this instance did not start (remount mid-
      // generation): reconcile from disk when it settles — this view never
      // sees the stream's "done" event (cave-0er).
      if (!streamOwnerRef.current) refetchOnSettleRef.current = sessionId;
      return;
    }
    if (live) {
      // Stale/aborted snapshot whose cleanup never ran — evict it so neither
      // this view nor the subscription re-adopts a dead "Streaming…" state,
      // then fall through to loading the conversation from disk. The evict
      // emits a null notification; swallow it (we are about to load from
      // disk anyway). If the orphaned stream is in fact still running, its
      // own clear on settle fires a SECOND notification — arm the settle
      // refetch so the finished response gets picked up then (cave-0er).
      skipSettleNotifyRef.current += 1;
      clearLiveChatGeneration(sessionId);
      if (!live.controller.signal.aborted) refetchOnSettleRef.current = sessionId;
    }
    let cancelled = false;
    void (async () => {
      setHistoryState("loading");
      try {
        const res = await fetch(`/api/chat/conversation/${sessionId}`, { cache: "no-store" });
        if (!res.ok) {
          if (cancelled) return;
          if (keepLiveSession()) {
            setHistoryState("loaded");
            return;
          }
          if (res.status === 404 && flowBackedSession) {
            const transcript = await loadFlowSessionTranscript(sessionId);
            if (cancelled) return;
            if (keepLiveSession()) {
              setHistoryState("loaded");
              return;
            }
            const cleanedTranscript = transcript ? stripStepMarkers(transcript) : "";
            if (cleanedTranscript) {
              setTurns([]);
              setActiveLeafId("");
              setFlowTranscriptFallback(cleanedTranscript);
              setHistoryState("loaded");
              return;
            }
          }
          if (!cancelled) {
            setTurns([]);
            setActiveLeafId("");
            setFlowTranscriptFallback(null);
            setHistoryState(res.status === 404 ? "missing" : "error");
          }
          return;
        }
        const json = await res.json() as {
          ok?: boolean;
          context?: ChatLinkedContext | null;
          conversation?: {
            activeLeafId?: string;
            turns?: Array<{
              id: string;
              parentId?: string | null;
              role: string;
              text: string;
              attachments?: ChatAttachment[];
              reasoning?: string;
              tools?: ToolEvent[];
              durationMs?: number;
              isError?: boolean;
              usage?: TurnUsage;
              costUsd?: number;
              responseMetadata?: ChatResponseMetadata;
              createdAt?: string;
              origin?: "chat" | "voice";
              voiceCallId?: string;
            }>;
          };
        };
        if (cancelled) return;
        setLinkedContext(json.context ?? null);
        if (json.ok && json.conversation) {
          setFlowTranscriptFallback(null);
          setTurns(
            (json.conversation.turns ?? [])
              .filter(
                (t): t is {
                  id: string;
                  parentId?: string | null;
                  role: "user" | "assistant";
                  text: string;
                  attachments?: ChatAttachment[];
                  reasoning?: string;
                  tools?: ToolEvent[];
                  durationMs?: number;
                  isError?: boolean;
                  usage?: TurnUsage;
                  costUsd?: number;
                  responseMetadata?: ChatResponseMetadata;
                  cancelled?: boolean;
                  createdAt?: string;
                  origin?: "chat" | "voice";
                  voiceCallId?: string;
                } => t.role === "user" || t.role === "assistant",
              )
              .map((t) => ({
                  id: t.id,
                  parentId: t.parentId,
                  role: t.role,
                  text: t.text,
                  attachments: t.attachments,
                  reasoning: t.reasoning,
                  tools: t.tools,
                  durationMs: t.durationMs,
                  usage: t.usage,
                  costUsd: t.costUsd,
                  responseMetadata: t.responseMetadata,
                  error: t.isError,
                  lifecycle: t.cancelled ? ("cancelled" as const) : undefined,
                  createdAt: t.createdAt ?? new Date().toISOString(),
                  origin: t.origin,
                  voiceCallId: t.voiceCallId,
                })),
          );
          setActiveLeafId(
            typeof json.conversation.activeLeafId === "string" ? json.conversation.activeLeafId : "",
          );
          setHistoryState("loaded");
        } else if (json.ok && json.context) {
          // Known affiliation (e.g. fresh task chat) — no transcript yet.
          if (keepLiveSession()) {
            setHistoryState("loaded");
            return;
          }
          setFlowTranscriptFallback(null);
          setTurns([]);
          setActiveLeafId("");
          setHistoryState("loaded");
        } else {
          if (keepLiveSession()) {
            setHistoryState("loaded");
            return;
          }
          setFlowTranscriptFallback(null);
          setTurns([]);
          setActiveLeafId("");
          setHistoryState("missing");
        }
      } catch {
        if (!cancelled) {
          if (keepLiveSession()) {
            setHistoryState("loaded");
            return;
          }
          setFlowTranscriptFallback(null);
          setTurns([]);
          setActiveLeafId("");
          setHistoryState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, historyRetryKey, flowBackedSession]);

  // Pin: while following, every turns mutation snaps the scroller to the
  // bottom INSTANTLY (scrollTop assignment inside a rAF, coalescing multiple
  // SSE chunks per frame). Never a queued smooth animation per chunk — that
  // is the CHAT-D10-01 bug, and instant pinning also satisfies
  // prefers-reduced-motion during streaming (CHAT-D13-03).
  useEffect(() => {
    if (!followingRef.current) return;
    if (pinFrameRef.current !== null) return;
    pinFrameRef.current = requestAnimationFrame(() => {
      pinFrameRef.current = null;
      const el = scrollRef.current;
      if (!el || !followingRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
  }, [turns]);

  useEffect(() => () => {
    if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current);
  }, []);

  // A freshly opened chat (or session switch) follows by default; the pin
  // effect above then handles the initial scroll-to-bottom once history lands.
  // Reset the render cap too so a long previous transcript doesn't keep the
  // whole DOM mounted for the next session.
  useEffect(() => {
    updateFollowing(true);
    setHistoryExpanded(false);
    expandAnchorRef.current = null;
  }, [sessionId, updateFollowing]);

  // Release on intent: only USER input events detach following. Programmatic
  // pins (scrollTop assignment, FAB scrollTo) emit scroll events but never
  // wheel/touch/key events, so they are structurally excluded from intent
  // detection here.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastTouchY: number | null = null;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && followingRef.current) updateFollowing(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      // Finger moving down the screen drags content down = scrolling up.
      if (lastTouchY !== null && y > lastTouchY && followingRef.current) updateFollowing(false);
      lastTouchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") && followingRef.current) {
        updateFollowing(false);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [updateFollowing]);

  // Re-pin: only when the user actually returns to the true bottom (small
  // epsilon). While following this is a no-op, so the pin's own scroll events
  // can never count as user intent.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (followingRef.current) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap <= 4) updateFollowing(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [updateFollowing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  function resizeComposer() {
    const el = inputRef.current;
    if (!el) return;
    const computedMaxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight);
    const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : COMPOSER_MAX_HEIGHT;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    const isOverflowing = el.scrollHeight > maxHeight;
    el.style.overflowY = isOverflowing ? "auto" : "hidden";
  }

  useEffect(() => {
    resizeComposer();
  }, [input]);

  // CHAT-D10-03: Track new turns arriving while not following
  const appendTurn = (newTurn: Turn | Turn[]) => {
    if (!followingRef.current) {
      setNewTurnsCount((c) => c + (Array.isArray(newTurn) ? newTurn.length : 1));
    }
  };

  const appendSystem = (text: string) => {
    const newTurn = {
      id: crypto.randomUUID(),
      role: "system" as const,
      text,
      createdAt: new Date().toISOString(),
    };
    appendTurn(newTurn);
    setTurns((prev) => [...prev, newTurn]);
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

  // Drop a prompt template into the composer for editing — never a send. When
  // the body carries a {{placeholder}}, select the first one so typing
  // replaces it; otherwise park the caret at the end.
  const insertPrompt = (p: PromptOption) => {
    const ins = promptInsertion(p);
    setInput(ins.text);
    setSlashIdx(0);
    announce("Prompt inserted — edit and send.");
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (ins.selectStart !== undefined && ins.selectEnd !== undefined) {
        el.setSelectionRange(ins.selectStart, ins.selectEnd);
      } else {
        el.setSelectionRange(ins.text.length, ins.text.length);
      }
    });
  };

  // Invoke a picked skill (from the /skill picker or the command menu's Skills
  // group). A skill with an argument-hint autofills `/skill <id> ` so the user
  // can type arguments; picking again on the filled text (or a hint-less
  // skill) sends the invocation directive. Mirrors the command menu's
  // autocomplete-then-run Enter pattern.
  const invokeSkillOption = (s: SkillOption) => {
    const filled = `/skill ${s.id}`;
    if (s.argumentHint && input.trim().toLowerCase() !== filled.toLowerCase()) {
      setInput(`${filled} `);
      inputRef.current?.focus();
      return;
    }
    setInput("");
    setSlashIdx(0);
    setTimeout(() => sendRaw(buildSkillPrompt(s)), 0);
    inputRef.current?.focus();
  };

  const intentFromSlash = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("/")) return false;
    const space = trimmed.indexOf(" ");
    const token = space < 0 ? trimmed : trimmed.slice(0, space);
    const args = space < 0 ? "" : trimmed.slice(space + 1).trim();
    const command = canonicalize(token) ?? token;

    if (command === "/clear") {
      liveSessionIdRef.current = null;
      setTurns([]);
      setActiveLeafId("");
      setInput("");
      return true;
    }
    if (command === "/help") {
      appendSystem(formatHelp());
      setInput("");
      return true;
    }
    if (command === "/model") {
      const current =
        modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
          ? modelState.effectiveModel
          : null;
      if (!args.trim()) {
        appendSystem(formatModelList(modelHarness, current));
        setInput("");
        return true;
      }
      const id = resolveModelArg(args, modelHarness);
      if (!id) {
        appendSystem(`Unknown model "${args.trim()}". Type /model to list the options.`);
        setInput("");
        return true;
      }
      handleSelectModel(id);
      appendSystem(`Model set to ${id}.`);
      setInput("");
      return true;
    }
    if (command === "/skill" || command === "/skills") {
      if (!args.trim()) {
        // Bare /skill or /skills: list everything (the inline picker shows the
        // same list while typing; this is the submitted fallback).
        appendSystem(formatSkillList(skills));
        setInput("");
        return true;
      }
      const invocation = resolveSkillInvocation(args, skills);
      if (!invocation) {
        appendSystem(`Unknown skill "${args.trim()}". Type /skills to list the options.`);
        setInput("");
        return true;
      }
      const { skill, args: skillArgs } = invocation;
      // A hinted skill submitted without arguments (and not already the exact
      // `/skill <id>` form — that means "run it anyway") autofills for editing.
      if (skill.argumentHint && !skillArgs && trimmed.toLowerCase() !== `/skill ${skill.id}`.toLowerCase()) {
        setInput(`/skill ${skill.id} `);
        return true;
      }
      setInput("");
      // Invoke by sending a directive to the active familiar's harness, which
      // owns Skill execution (mirrors the /run prompt-send pattern).
      setTimeout(() => sendRaw(buildSkillPrompt(skill, skillArgs)), 0);
      return true;
    }
    if (command === "/prompt" || command === "/prompts") {
      if (!args.trim()) {
        // Bare /prompt or /prompts: list everything (the inline picker shows
        // the same list while typing; this is the submitted fallback).
        appendSystem(formatPromptList(prompts));
        setInput("");
        return true;
      }
      const prompt = resolvePromptArg(args, prompts);
      if (!prompt) {
        appendSystem(`Unknown prompt "${args.trim()}". Type /prompts to list the options.`);
        setInput("");
        return true;
      }
      insertPrompt(prompt);
      return true;
    }
    if (command === "/doctor" || command === "/daemon") {
      setInput("");
      void runCovenExec(command === "/doctor" ? "doctor" : "daemon");
      return true;
    }
    if (command === "/canvas") {
      if (!args.trim()) {
        // No prompt → open the full Canvas page via the workspace.
        if (onSlashCommand?.("/canvas", "")) { setInput(""); return true; }
        return true;
      }
      setInput("");
      const wrapped = buildSketchPrompt(args);
      setTimeout(() => void sendRaw(args, [], [], { promptOverride: wrapped }), 0);
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

  const sendRaw = async (
    text: string,
    outgoingAttachments: ChatAttachment[] = [],
    outgoingMentions: string[] = [],
    opts?: { promptOverride?: string; parentTurnId?: string | null },
    controlsOverride?: { thinkingEffort: ComposerThinkingEffort; responseSpeed: ComposerResponseSpeed; runtimeHost?: string },
  ) => {
    const trimmed = text.trim();
    const submitPrompt = opts?.promptOverride?.trim() || trimmed;
    if ((!trimmed && outgoingAttachments.length === 0) || busy) return;
    const request: FailedSend = {
      text: trimmed,
      attachments: outgoingAttachments,
      ...(outgoingMentions.length ? { mentionedFiles: outgoingMentions } : {}),
      ...(opts?.promptOverride ? { promptOverride: opts.promptOverride } : {}),
    };
    setBusy(true);
    setError(null);
    setDebugError(null);
    setLastFailedSend(null);
    setProjectAccessRoot(null);
    const initialLiveSessionId = currentSessionRef.current;
    liveSessionIdRef.current = initialLiveSessionId;
    setHistoryState("loaded");

    // Explicit parentTurnId (including null = root) wins; only fall back to the
    // current leaf when the caller did not specify a branch point at all.
    const resolvedParentId =
      opts?.parentTurnId !== undefined ? opts.parentTurnId : (activeLeafId || null);
    const now = new Date().toISOString();
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      parentId: resolvedParentId,
      role: "user",
      text: trimmed,
      ...(outgoingAttachments.length ? { attachments: outgoingAttachments } : {}),
      createdAt: now,
    };
    const assistantId = crypto.randomUUID();
    const assistantTurn: Turn = {
      id: assistantId,
      parentId: userTurn.id,
      role: "assistant",
      text: "",
      pending: true,
      lifecycle: "queued",
      createdAt: now,
      tools: [],
      progress: [
        { id: "queued", label: "Queued request", status: "done", createdAt: now },
        { id: "connect", label: "Connecting to chat bridge", status: "running", createdAt: now },
      ],
    };
    const controller = new AbortController();
    const liveGeneration = { sessionId: initialLiveSessionId, controller };
    const runId = crypto.randomUUID();
    abortRef.current = controller;
    stopKeysRef.current = { runId, sessionId: initialLiveSessionId ?? null };
    streamOwnerRef.current = true;
    refetchOnSettleRef.current = null;
    const nextTurns = [...turnsRef.current, userTurn, assistantTurn];
    appendTurn([userTurn, assistantTurn]);
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setActiveLeafId(assistantTurn.id);
    if (liveGeneration.sessionId) {
      recordLiveChatGeneration({
        sessionId: liveGeneration.sessionId,
        controller,
        turns: nextTurns,
        activeLeafId: assistantTurn.id,
        updatedAt: Date.now(),
      });
    }
    try {
      setAssistantLifecycle(assistantId, "connecting", liveGeneration.sessionId);
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: familiar.id,
          prompt: submitPrompt,
          runId,
          ...(outgoingAttachments.length ? { attachments: stripPreviewOnlyAttachmentFieldsKeepingImages(outgoingAttachments) } : {}),
          ...(origin ? { origin } : {}),
          sessionId: liveGeneration.sessionId,
          projectRoot: requestProjectRoot,
          reasoningEffort: controlsOverride?.thinkingEffort ?? thinkingEffort,
          responseSpeed: controlsOverride?.responseSpeed ?? responseSpeed,
          // Advisory permission mode for the picked access level; the daemon may
          // ignore it if the harness doesn't support per-turn permission scoping.
          permissionMode,
          // Composer Host chip: only an explicit pick rides; the server
          // resolves it against the registered-host registry fail-closed.
          ...((controlsOverride?.runtimeHost ?? runtimeHost) ? { runtimeHost: controlsOverride?.runtimeHost ?? runtimeHost } : {}),
          // Forward the picked model explicitly so it reaches `coven run
          // --model` for THIS turn — don't rely on the PATCH to model-state
          // having persisted to the conversation file before this send (a
          // race), and so a brand-new chat (no sessionId yet) still pins its
          // session model. Only session-scoped picks need this; familiar- and
          // global-default models already resolve server-side from config.
          ...(modelState?.source === "session" &&
          modelState.effectiveModel &&
          modelState.effectiveModel !== "unknown"
            ? {
                modelOverride: modelState.effectiveModel,
                modelOverrideScope: "session" as const,
              }
            : {}),
          // CHAT-D1-04: @-mentioned repo files ride with the root they are
          // relative to — resumed sessions don't resend projectRoot above.
          ...(outgoingMentions.length && mentionRoot
            ? {
                mentionedFiles: outgoingMentions.slice(0, MAX_FILE_MENTIONS),
                mentionedFilesRoot: mentionRoot,
              }
            : {}),
          // Branching: when regenerating or re-editing from a non-leaf
          // position, send the explicit parent so the server builds the new
          // turn off the right node rather than defaulting to the current
          // active leaf.
          ...(opts?.parentTurnId !== undefined ? { parentTurnId: opts.parentTurnId } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const message = await chatBridgeFailureMessage(res);
        setError(message);
        setLastFailedSend(request);
        // A 403 here is the project-access gate: the chat's cwd belongs to no
        // registered project the familiar can reach. Capture that cwd so the
        // error strip can offer a one-click "register + grant, then retry".
        if (res.status === 403 && /project access denied|not registered/i.test(message)) {
          const failingRoot = (activeProjectRoot || session?.project_root || projectRoot || "").trim();
          setProjectAccessRoot(failingRoot || null);
        }
        upsertTurnProgress(assistantId, {
          id: "connect",
          label: `Chat bridge rejected the request: ${message}`,
          status: "error",
        }, liveGeneration.sessionId);
        markAssistantError(assistantId, liveGeneration.sessionId);
        raiseDebugError({ turnId: assistantId, code: `HTTP ${res.status}` });
        return;
      }
      if (!res.body) {
        const message = "Chat bridge response did not include a stream";
        setError(message);
        setLastFailedSend(request);
        upsertTurnProgress(assistantId, {
          id: "connect",
          label: message,
          status: "error",
        }, liveGeneration.sessionId);
        markAssistantError(assistantId, liveGeneration.sessionId);
        raiseDebugError({ turnId: assistantId, code: "NO_STREAM" });
        return;
      }

      upsertTurnProgress(assistantId, {
        id: "connect",
        label: "Connected to chat bridge",
        status: "done",
      }, liveGeneration.sessionId);
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
            handleEvent(ev, assistantId, request, liveGeneration);
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        updateLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  pending: false,
                  lifecycle: "cancelled",
                  text: t.text || "(cancelled)",
                  progress: settleRunningProgress(
                    upsertProgressEvent(t.progress, {
                      id: "cancelled",
                      label: "Cancelled by user",
                      status: "error",
                    }),
                    "error",
                  ),
                }
              : t,
          ),
          assistantId,
          undefined,
          liveGeneration.sessionId,
        );
      } else {
        setError(err instanceof Error ? err.message : "send failed");
        setLastFailedSend(request);
        markAssistantError(assistantId, liveGeneration.sessionId);
        raiseDebugError({ turnId: assistantId });
      }
    } finally {
      streamOwnerRef.current = false;
      clearLiveChatGeneration(liveGeneration.sessionId);
      abortRef.current = null;
      stopKeysRef.current = { runId: null, sessionId: null };
      setBusy(false);
    }
  };

  const cancelSend = () => {
    const { runId, sessionId } = stopKeysRef.current;
    if (runId || sessionId) {
      // Deliberate Stop is an explicit server call (kills the harness and
      // persists the honest cancelled record); the abort below only tears
      // down this client's stream.
      void fetch("/api/chat/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(runId ? { runId } : {}),
          ...(sessionId ? { sessionId } : {}),
        }),
      }).catch(() => {
        /* best-effort — the server's detach cap still bounds the run */
      });
    }
    abortRef.current?.abort();
  };

  function retryLastSend() {
    if (!lastFailedSend || busy) return;
    setError(null);
    setLastFailedSend(null);
    void sendRaw(
      lastFailedSend.text,
      lastFailedSend.attachments,
      lastFailedSend.mentionedFiles ?? [],
      lastFailedSend.promptOverride ? { promptOverride: lastFailedSend.promptOverride } : undefined,
    );
  }

  // Recovery for a 403 project-access failure: register the chat's cwd as a
  // Cave project and grant it to this familiar (both user-initiated writes the
  // server accepts), then retry the send. The daemon re-reads projects/grants
  // from disk, so the same request now clears the gate.
  async function handleAddProject() {
    const root = projectAccessRoot;
    if (!root || addingProject) return;
    setAddingProject(true);
    try {
      const result = await addChatProject({
        root,
        familiarId: familiar?.id ?? null,
        createProject,
        existingProjectId: projectIdForRoot(root, projects),
      });
      if (result.ok) {
        reloadProjects();
        setProjectAccessRoot(null);
        setError(null);
        retryLastSend();
      } else {
        setError(`Could not add project: ${result.error}`);
      }
    } finally {
      setAddingProject(false);
    }
  }

  function enhancePrompt() {
    const draft = input.trim();
    if (!draft || busy || enhanceStatus === "loading") return;
    setEnhanceOriginal(input);
    setEnhanceStatus("loading");
    const result = buildPromptEnhancement({
      draft: input,
      mode: activeProjectRoot ? "code" : "chat",
      context: {
        activeProject: activeProjectRoot
          ? { name: selectedProject?.name ?? null, root: activeProjectRoot }
          : null,
        selectedFiles: [...mentionedFiles, ...attachments.map((attachment) => attachment.name)],
        recentThreadTitle: session?.title ?? null,
      },
    });
    if (!result.ok || !result.enhanced.trim()) {
      setEnhanceStatus("error");
      return;
    }
    setInput(result.enhanced);
    setEnhanceStatus("success");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  // CHAT-D6-01: edit-and-resend. Loads a user turn's text into the composer so
  // the user can revise and send it as a NEW message — append semantics, no
  // truncation/forking (that's D6-03: the harness session keeps its own
  // server-side context, so locally rewriting the transcript would lie on
  // reload). A non-empty draft is never silently destroyed: we only prefill
  // when the composer is empty, and always hand focus back to it.
  // When the edited turn is the LAST user turn on the active path, the next
  // send will branch from its parent (creating a sibling instead of a child).
  function editTurnInComposer(turn: Turn) {
    setInput((current) => (current.trim() ? current : turn.text));
    const lastUser = [...activePath].reverse().find((t) => t.role === "user");
    if (lastUser?.id === turn.id) setPendingBranchParent(turn.parentId ?? null);
    inputRef.current?.focus();
  }

  // Reply to Chat: stage a turn as the quoted target for the next message. The
  // quote rides INTO the outgoing prompt (buildQuotedPrompt) at send time so
  // the model sees what's being replied to and it persists across reload — the
  // composer just shows a dismissible chip until then. Assistant turns quote
  // only the visible prose (not hidden reasoning); the draft is never touched.
  function replyToTurn(turn: Turn) {
    const author =
      turn.role === "assistant" ? familiar.display_name : turn.role === "system" ? "System" : "You";
    const source = turn.role === "assistant" ? extractNextPaths(splitReasoning(turn.text).visible).visible : turn.text;
    const snippet = buildReplySnippet(source);
    if (!snippet) return;
    setReplyTarget({ turnId: turn.id, author, snippet });
    inputRef.current?.focus();
  }

  /** Build the Reply action for a settled, non-empty turn (undefined hides it). */
  function replyFor(turn: Turn): (() => void) | undefined {
    if (turn.pending) return undefined;
    // Cache the expensive replyable decision by the stable turn ref (see
    // `replyableTurnCache`); rebuild the cheap closure fresh so it never
    // captures a stale `replyToTurn`.
    let canReply = replyableTurnCache.get(turn);
    if (canReply === undefined) {
      const source =
        turn.role === "assistant" ? extractNextPaths(splitReasoning(turn.text).visible).visible : turn.text;
      canReply = source.trim().length > 0;
      replyableTurnCache.set(turn, canReply);
    }
    return canReply ? () => replyToTurn(turn) : undefined;
  }

  // CHAT-D6-02: regenerate. Re-sends the PRECEDING user turn (text +
  // attachments) through the normal guarded sendRaw path as a new turn pair.
  // Returns undefined (action hidden) while busy, on pending turns, on
  // assistant turns with no preceding user turn (e.g. system-injected), and
  // on assistant turns that are NOT the last on the active path (only the tip
  // gets a regenerate button so earlier branches keep their settled answers).
  function regenerateFor(turn: Turn): (() => void) | undefined {
    if (busy || turn.role !== "assistant" || turn.pending) return undefined;
    if (activePath[activePath.length - 1]?.id !== turn.id) return undefined;
    const idx = activePath.findIndex((t) => t.id === turn.id);
    if (idx < 0) return undefined;
    let prevUser: Turn | undefined;
    for (let j = idx - 1; j >= 0; j -= 1) {
      const candidate = activePath[j];
      if (candidate && candidate.role === "user") { prevUser = candidate; break; }
    }
    if (!prevUser) return undefined;
    const { text, attachments: prevAttachments, parentId } = prevUser;
    if (!text.trim() && !prevAttachments?.length) return undefined;
    // null parentId (root user turn) must be forwarded as null, not undefined,
    // so the regenerated answer becomes a root sibling rather than appending.
    return () => void sendRaw(text, prevAttachments ?? [], [], { parentTurnId: parentId ?? null });
  }

  // Branch navigator: switch to a sibling turn and make its deepest descendant
  // the new active leaf. Persists the new leaf to the conversation so a reload
  // restores the same branch. Optimistic — the in-memory switch is immediate;
  // the PATCH is best-effort (network errors are silently swallowed).
  async function switchBranch(turnId: string, dir: -1 | 1) {
    const { siblings, index } = siblingsFor(turnId);
    const next = siblings[index + dir];
    if (!next) return;
    const leaf = childLeaf(turns, next.id);
    setActiveLeafId(leaf);
    if (!sessionId) return;
    try {
      await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeLeafId: leaf }),
      });
    } catch {
      // optimistic; the in-memory switch already happened
    }
  }

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text && attachments.length === 0) return;
    if (attachments.length === 0 && intentFromSlash(text)) return;
    // CHAT-D5-01: sendRaw early-returns while a response is streaming, so
    // clearing the composer first would silently destroy the typed message
    // (and staged attachments). Bail before touching state — slash intents
    // above still run mid-stream; plain sends keep the draft intact.
    if (busy) return;
    const outgoingAttachments = attachments.map(({ id: _id, ...attachment }) => attachment);
    // Only mentions whose `@path` token survived editing ride along — a
    // deleted reference must not silently re-enter the prompt.
    const outgoingMentions = mentionedFiles
      .filter((p) => text.includes(`@${p}`))
      .slice(0, MAX_FILE_MENTIONS);
    // CHAT-D11-04: Add to input history (the raw draft, without the quote
    // prefix — ↑ recall should restore what the user typed, not the blockquote).
    setInputHistory((prev) => [...prev, text]);
    setInputHistoryIdx(-1);
    // Reply to Chat: fold the quoted target into the outgoing prompt so the
    // model sees it and it persists in the transcript; pass-through when unset.
    const outgoingText = buildQuotedPrompt(replyTarget, text);
    setReplyTarget(null);
    setInput("");
    setAttachments([]);
    setMentionedFiles([]);
    // Branching: consume a pending branch parent set by editTurnInComposer.
    // Read-and-clear atomically so it only applies to THIS send.
    const branchParent = pendingBranchParent;
    setPendingBranchParent(undefined);
    await sendRaw(outgoingText, outgoingAttachments, outgoingMentions, branchParent !== undefined ? { parentTurnId: branchParent } : undefined);
  };

  // Auto-send a prompt handed off from the home composer. Deferred one
  // macrotask so it runs after strict-mode's mount-effect replay — sending
  // synchronously here lets the replayed history-load effect (null-session
  // branch) setTurns([]) right after sendRaw appended the optimistic bubbles,
  // leaving a busy composer over an empty thread. The cleanup cancels the
  // first pass's timer, so only the final pass sends; the ref latches when
  // the send actually fires. The router drops initialPrompt from its view
  // state on session promotion, which clears the prop and re-arms the guard
  // for the next handoff.
  useEffect(() => {
    if (!initialPrompt) {
      initialPromptSentRef.current = false;
      return;
    }
    if (initialPromptSentRef.current || sessionId) return;
    const timer = window.setTimeout(() => {
      if (initialPromptSentRef.current) return;
      initialPromptSentRef.current = true;
      const normalized = initialControls ? normalizeCommandControls(initialControls) : null;
      if (normalized) {
        setThinkingEffort(normalized.thinkingEffort);
        setResponseSpeed(normalized.responseSpeed);
      }
      // The home composer's host pick rides the first send explicitly (state
      // set below lands too late for this closure) and seeds the chip.
      if (initialControls?.runtimeHost) setRuntimeHost(initialControls.runtimeHost);
      void sendRaw(
        initialPrompt,
        initialAttachments ?? [],
        [],
        undefined,
        normalized
          ? { ...normalized, runtimeHost: initialControls?.runtimeHost }
          : undefined,
      );
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, sessionId]);

  const attachFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 10 - attachments.length));
    if (selected.length === 0) return;
    const next = await Promise.all(selected.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...next]);
    inputRef.current?.focus();
  };

  // "Start a task" tail end: the first send's "session" event hands over the
  // session id, and the card follows the chat. Fire-and-forget — a failed card
  // create must never disturb the running stream.
  const createLinkedTaskCard = async (forSessionId: string, promptText: string) => {
    const firstLine = promptText.split("\n")[0]?.trim() ?? "";
    const title = (firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine) || "New task";
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          familiarId: familiar.id,
          projectId: resolvedProjectId !== NO_PROJECT_ID ? resolvedProjectId : null,
          cwd: activeProjectRoot || null,
          sessionId: forSessionId,
          status: "running",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.card) throw new Error(json.error ?? "failed to create task card");
      const card = json.card as Card;
      const task = {
        id: card.id,
        title: card.title,
        status: card.status,
        priority: card.priority,
        lifecycle: card.lifecycle,
        labels: card.labels,
        cwd: card.cwd,
        projectId: card.projectId ?? null,
        notes: card.notes?.trim() || null,
      };
      // Optimistic: the Task chip appears now; the conversation reload keeps it.
      setLinkedContext((prev) =>
        prev?.task ? prev : { task, tasks: [task, ...(prev?.tasks ?? [])], github: prev?.github ?? [] },
      );
      announce("Task card created and linked to this chat.");
    } catch {
      announce("Could not create the task card — the chat continues unlinked.", "assertive");
    }
  };

  const handleEvent = (
    ev: StreamEvent,
    assistantId: string,
    request: FailedSend,
    liveGeneration: { sessionId: string | null; controller: AbortController },
  ) => {
    switch (ev.kind) {
      case "session": {
        liveGeneration.sessionId = ev.sessionId;
        if (ev.sessionId !== currentSessionRef.current) {
          liveSessionIdRef.current = ev.sessionId;
          currentSessionRef.current = ev.sessionId;
          setHistoryState("loaded");
          onSessionStarted?.(ev.sessionId);
        }
        if (taskArmedRef.current) {
          // One-shot: clear before the async create so a second session event
          // (or a retried send) can't double-create the card.
          taskArmedRef.current = false;
          setTaskArmed(false);
          void createLinkedTaskCard(ev.sessionId, request.text);
        }
        persistLiveTurns(turnsRef.current, assistantId, liveGeneration.controller, liveGeneration.sessionId);
        return;
      }
      case "assistant_chunk": {
        setAssistantLifecycle(assistantId, "streaming", liveGeneration.sessionId);
        updateLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  text: appendCollapsingNewlines(t.text, ev.text),
                  pending: true,
                  lifecycle: "streaming",
                  // CHAT-D12-01: settle the synthetic row the moment text is
                  // flowing — the streamed text IS the live signal from here
                  // on. Leaving it "running" kept the auto-open ProgressGroup
                  // pulsing for the entire stream.
                  progress: upsertProgressEvent(t.progress, {
                    id: "stream",
                    label: "Receiving response",
                    status: "done",
                  }),
                }
              : t,
          ),
          assistantId,
          undefined,
          liveGeneration.sessionId,
        );
        return;
      }
      case "attachment": {
        // Agent-produced inline attachment: append to the live assistant turn
        // so a file chip renders immediately (persisted copy arrives on reload).
        updateLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, attachments: [...(t.attachments ?? []), ev.attachment] }
              : t,
          ),
          assistantId,
          undefined,
          liveGeneration.sessionId,
        );
        return;
      }
      case "progress": {
        upsertTurnProgress(assistantId, ev, liveGeneration.sessionId);
        return;
      }
      case "tool_use": {
        setAssistantLifecycle(assistantId, "tooling", liveGeneration.sessionId);
        const incoming: ToolEvent = {
          id: ev.id ?? crypto.randomUUID(),
          name: ev.name,
          input: ev.input,
          output: ev.output,
          status: ev.status ?? "running",
          durationMs: ev.durationMs,
        };
        updateLiveTurns((prev) =>
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
                          // CHAT-D4-01: keep the offset captured when the
                          // call first arrived — settle events must not move
                          // the block.
                          textOffset: x.textOffset,
                        }
                      : x,
                  )
                : // CHAT-D4-01: first event for this call — record how much
                  // text had streamed so far, so the tool block renders at
                  // its chronological position between prose spans.
                  [...tools, { ...incoming, textOffset: t.text.length }];
            // Post-tool events carry no input, so summarize from the merged
            // record (which preserves the input captured at pre-tool time).
            const argSummary = toolArgSummary(
              incoming.name,
              existingIdx >= 0 ? nextTools[existingIdx]?.input : incoming.input,
            );
            return {
              ...t,
              tools: nextTools,
              lifecycle: t.pending ? "tooling" : t.lifecycle,
              progress: upsertProgressEvent(t.progress, {
                id: "tools",
                label: incoming.status === "running" ? "Tool call running" : "Tool call finished",
                detail: argSummary ? `${incoming.name}(${argSummary})` : incoming.name,
                status: incoming.status === "error" ? "error" : incoming.status === "ok" ? "done" : "running",
                durationMs: incoming.durationMs,
              }),
            };
          }),
          assistantId,
          undefined,
          liveGeneration.sessionId,
        );
        return;
      }
      case "done": {
        updateLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  pending: false,
                  error: ev.isError ?? false,
                  lifecycle: ev.isError ? "failed" : "complete",
                  durationMs: ev.durationMs,
                  usage: ev.usage,
                  costUsd: ev.costUsd,
                  responseMetadata: ev.responseMetadata,
                  progress: settleRunningProgress(t.progress, ev.isError ? "error" : "done"),
                }
              : t,
          ),
          assistantId,
          undefined,
          liveGeneration.sessionId,
        );
        if (ev.isError) {
          setLastFailedSend(request);
          // A turn that finishes with isError used to leave no banner — only an
          // inline failed marker. Surface it in the debug strip too, pulling the
          // message from the turn's errored step when the stream gave none.
          setError((prev) => prev ?? "The agent run ended with an error.");
          raiseDebugError({ turnId: assistantId });
        }
        void refreshUsagePlan(ev.responseMetadata?.confirmedModel ?? ev.responseMetadata?.model ?? null);
        if (ev.sessionId && ev.sessionId !== currentSessionRef.current) {
          liveGeneration.sessionId = ev.sessionId;
          liveSessionIdRef.current = ev.sessionId;
          currentSessionRef.current = ev.sessionId;
          setHistoryState("loaded");
          onSessionStarted?.(ev.sessionId);
        }
        persistLiveTurns(turnsRef.current, assistantId, liveGeneration.controller, liveGeneration.sessionId);
        return;
      }
      case "error": {
        setError(ev.message);
        setLastFailedSend(request);
        markAssistantError(assistantId, liveGeneration.sessionId);
        raiseDebugError({ turnId: assistantId, code: ev.code });
        if (ev.code === "ENOENT") onOpenOnboarding?.();
        return;
      }
    }
  };

  const markAssistantError = (id: string, targetSessionId: string | null = currentSessionRef.current) => {
    updateLiveTurns((prev) =>
      prev.map((t) => (
        t.id === id
          ? { ...t, pending: false, error: true, lifecycle: "failed", progress: settleRunningProgress(t.progress, "error") }
          : t
      )),
      id,
      undefined,
      targetSessionId,
    );
  };

  function setAssistantLifecycle(
    id: string,
    lifecycle: ChatTurnLifecycle,
    targetSessionId: string | null = currentSessionRef.current,
  ) {
    updateLiveTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, lifecycle } : t)),
      id,
      undefined,
      targetSessionId,
    );
  }

  function upsertTurnProgress(
    id: string,
    event: {
      id?: string;
      label: string;
      detail?: string;
      status?: "running" | "done" | "error";
      durationMs?: number;
    },
    targetSessionId: string | null = currentSessionRef.current,
  ) {
    updateLiveTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, progress: upsertProgressEvent(t.progress, event) } : t)),
      id,
      undefined,
      targetSessionId,
    );
  }

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const file = mentionMatches[mentionActiveIdx];
        if (file) selectMention(file);
        return;
      }
      // Esc precedence: an open mention menu consumes Esc (dismiss) before
      // the slash-menu and busy-cancel branches below (#402 ordering). The
      // two menus never open together — `@` is mid-token, `/` first-token.
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (modelMenuActive && modelOptions) {
      const opts = modelOptions;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, opts.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const m = opts[slashIdx];
        if (m) setInput(`/model ${m.id}`);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const m = opts[slashIdx];
        if (m) {
          handleSelectModel(m.id);
          appendSystem(`Model set to ${m.id}.`);
          setInput("");
        }
        return;
      }
    }
    if (skillMenuActive && skillOptions) {
      const opts = skillOptions;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, opts.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const s = opts[slashIdx];
        if (s) setInput(`/skill ${s.id}`);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const s = opts[slashIdx];
        if (s) invokeSkillOption(s);
        return;
      }
    }
    if (promptMenuActive && promptOptions) {
      const opts = promptOptions;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, opts.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const p = opts[slashIdx];
        if (p) setInput(`/prompt ${p.id}`);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const p = opts[slashIdx];
        if (p) insertPrompt(p);
        return;
      }
    }
    if (slashSuggestions.length > 0 || skillCommandRows.length > 0) {
      // One roving index across commands, then the Skills group beneath them.
      const total = slashSuggestions.length + skillCommandRows.length;
      const skillAt = (i: number): SkillOption | undefined =>
        skillCommandRows[i - slashSuggestions.length];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, total - 1));
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
        const s = skillAt(slashIdx);
        if (cmd) setInput(cmd.name + (cmd.argPlaceholder ? " " : ""));
        else if (s) setInput(`/skill ${s.id} `);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = slashSuggestions[slashIdx];
        const s = skillAt(slashIdx);
        // If the highlighted command takes an argument and the input isn't
        // the exact command yet, autocomplete first (like Tab) so the user
        // can fill in args; otherwise run the highlighted suggestion — not
        // the partially typed text. Mirrors home-composer.
        if (cmd && cmd.argPlaceholder && canonicalize(input.trim()) !== cmd.name) {
          setInput(cmd.name + " ");
        } else if (cmd) {
          intentFromSlash(cmd.name);
        } else if (s) {
          invokeSkillOption(s);
        }
        return;
      }
      // Esc precedence: an open slash menu consumes Esc (dismiss) before
      // the busy branch below gets a chance to cancel the stream.
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    // CHAT-D11-04: Input history navigation (↑↓), matching HomeComposer
    if (e.key === "ArrowUp" && input === "" && inputHistory.length > 0) {
      e.preventDefault();
      const idx = inputHistoryIdx < inputHistory.length - 1 ? inputHistoryIdx + 1 : inputHistoryIdx;
      setInputHistoryIdx(idx);
      setInput(inputHistory[inputHistory.length - 1 - idx] ?? "");
      return;
    }
    if (e.key === "ArrowDown" && inputHistoryIdx > 0) {
      e.preventDefault();
      const idx = inputHistoryIdx - 1;
      setInputHistoryIdx(idx);
      setInput(inputHistory[inputHistory.length - 1 - idx] ?? "");
      return;
    }
    if (e.key === "ArrowDown" && inputHistoryIdx === 0) {
      e.preventDefault();
      setInputHistoryIdx(-1);
      setInput("");
      return;
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

  // Persist the composer draft so a reload restores a half-written message.
  // Cleared (key removed) when the input empties — e.g. after a send.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeComposerDraft(input);
    }, COMPOSER_DRAFT_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  // Persist the ↑/↓ prompt-history so past prompts survive a reload.
  useEffect(() => {
    writeComposerHistory(COMPOSER_HISTORY_KEY, inputHistory);
  }, [inputHistory]);

  // Sync the selected project when switching sessions. Also initialise the draft
  // the first time projects load (when it is still null). Do NOT overwrite a
  // user-set draft just because the projects list was re-fetched (e.g. after a
  // rename or create), which would discard an in-session selection. (The header
  // delete confirm resets itself — HeaderDeleteButton is keyed on sessionId.)
  useEffect(() => {
    setProjectIdDraft((prev) => {
      // Mirrors resolveChatProjectSelection: the linked task's project first
      // (a task chat belongs in its task's project), then a registered project
      // mapped from the session/opener root, then NO_PROJECT_ID for an
      // existing session in an unregistered cwd, then the first project only
      // for brand-new chats. linkedContext loads async with the conversation,
      // so its deps re-seed the draft once the task arrives.
      const resolved =
        resolveChatProjectSelection({
          draftId: null,
          hasSession: Boolean(session),
          sessionProjectRoot: session?.project_root,
          fallbackProjectRoot: projectRoot,
          taskProjectId: linkedContext?.task?.projectId,
          taskCwd: linkedContext?.task?.cwd,
          projects,
        }).projectId ??
        firstProject?.id ??
        null;
      // Initialise when unset, or always resync on session switch.
      return prev === null ? resolved : resolved ?? prev;
    });
    setMentionedFiles([]);
    setRuntimeHost(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.project_root, projectRoot, firstProject?.id, linkedContext?.task?.projectId, linkedContext?.task?.cwd]);

  // Re-read the per-session dismiss flag whenever the active chat changes, so
  // dismissing one chat doesn't silently hide the nudge on a different chat.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setArchiveNudgeDismissed(isChatArchiveNudgeDismissed(sessionId ?? "", window.localStorage));
  }, [sessionId]);

  const dismissArchiveNudge = useCallback(() => {
    if (typeof window !== "undefined" && sessionId) {
      markChatArchiveNudgeDismissed(sessionId, window.localStorage);
    }
    setArchiveNudgeDismissed(true);
  }, [sessionId]);

  const archiveChat = useCallback(async () => {
    if (!sessionId || archivingChat) return;
    setArchivingChat(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setError(json.error ?? "archive failed");
        return;
      }
      onSessionsChanged?.();
      onBack?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "archive failed");
    } finally {
      setArchivingChat(false);
    }
  }, [sessionId, archivingChat, onSessionsChanged, onBack]);

  const deleteChat = async () => {
    if (!sessionId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setError(json.error ?? "delete failed");
        return;
      }
      onSessionsChanged?.();
      onBack?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setDeleting(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      clearTranscript: () => {
        liveSessionIdRef.current = null;
        setTurns([]);
        setActiveLeafId("");
      },
      runSlash: (command: string) => {
        // Push command into the composer + dispatch
        if (command === "/clear") {
          liveSessionIdRef.current = null;
          setTurns([]);
          setActiveLeafId("");
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
    <section
      className="cave-chat-linear flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]"
      onKeyDown={onChatSectionKeyDown}
      onDragEnter={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropActive(false);
      }}
      onDrop={(e) => {
        dragDepthRef.current = 0;
        setDropActive(false);
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        void attachFiles(e.dataTransfer.files);
      }}
    >
      {dropActive ? (
        <div className="cave-drop-overlay" aria-hidden="true">
          <div className="cave-drop-overlay-inner">
            <Icon name="ph:paperclip" width={16} aria-hidden />
            <span>Drop files to attach</span>
          </div>
        </div>
      ) : null}
      <header className="cave-chat-linear-header">
        <div className="cave-mobile-header-identity">
          <div className="cave-mobile-header-familiar">
                  <FamiliarIcon familiar={familiar} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">{familiar.display_name}</div>
              <div className="truncate font-mono text-[10px] leading-tight text-[var(--text-muted)]">
                {familiar.harness ?? "cave"}
                {visibleModelId(familiar.model ?? undefined, familiar.harness ?? undefined)
                  ? ` · ${visibleModelId(familiar.model ?? undefined, familiar.harness ?? undefined)}`
                  : ""}
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
            onOpenDebug={sessionId ? () => setDebugModalOpen(true) : undefined}
          />
        </div>
        {linkedContext?.task ? (
          <MobileHeaderTask task={linkedContext.task} onOpenTask={onOpenTask} />
        ) : null}
        <MetaLine
          session={session ?? null}
          linkedContext={linkedContext}
          busy={busy}
          lifecycle={activeLifecycle}
          pendingSince={activePendingTurn?.createdAt ?? null}
          error={!!error}
          daemonRunning={daemonRunning}
          durationMs={lastSettledAssistantTurn?.durationMs}
          usage={lastSettledAssistantTurn?.usage}
          costUsd={lastSettledAssistantTurn?.costUsd}
          usagePlan={usagePlan}
          responseMetadata={lastSettledAssistantTurn?.responseMetadata}
          familiar={familiar}
          projectRoot={projectRoot}
          onSessionsChanged={onSessionsChanged}
          onBack={onBack}
        >
          <div className="cave-chat-session-actions">
            {turns.length > 0 ? (
              <ChatFindBar
                open={findOpen}
                query={findQuery}
                activeIndex={findActiveIdx}
                matchCount={findMatches.length}
                focusNonce={findFocusNonce}
                onOpen={openFind}
                onClose={closeFind}
                onQueryChange={setFindQuery}
                onNext={findNext}
                onPrev={findPrev}
              />
            ) : null}
            {turns.length > 0 ? <HeaderThinkingToggle /> : null}
            {sessionId && (
              <HeaderDebugButton onOpenDebug={openDebug} />
            )}
            {sessionId && (
              <HeaderDeleteButton key={sessionId} onDelete={() => void deleteChat()} deleting={deleting} />
            )}
            {sessionId && (
              <SessionOverflowMenu
                projects={projects}
                projectId={projectIdDraft}
                onProjectChange={setProjectIdDraft}
                onAddProject={overflowAddProject.beginAddProject}
                familiar={familiar}
                voiceActive={voiceCallOpen}
                onOpenVoice={() => setVoiceCallOpen(true)}
                onOpenDebug={openDebug}
              />
            )}
            {overflowAddProject.addProjectModal}
            {sessionId && familiar.id ? (
              <HeaderReflectButton reflecting={reflecting} onReflect={() => void reflectOnThread()} />
            ) : null}
          </div>
        </MetaLine>
        <LinkedContextRow
          linkedContext={linkedContext}
          onOpenTask={onOpenTask}
          sessionId={sessionId}
          onLinkedContextChange={setLinkedContext}
        />
      </header>
      <RunActivityStrip activeTurn={activePendingTurn} lastTurn={lastSettledAssistantTurn} />
      <ToolProjectRootContext.Provider value={session?.project_root ?? projectRoot ?? null}>
      <div ref={scrollRef} tabIndex={0} className="cave-chat-transcript relative min-h-0 flex-1 overflow-y-auto">
        <div
          className="cave-chat-thread"
          role="log"
          aria-label="Conversation"
          aria-busy={busy || undefined}
        >
          {turns.length === 0 ? (
            historyState === "loading" ? (
              <ChatHistorySkeleton />
            ) : flowTranscriptFallback ? (
              <FlowSessionTranscriptFallback
                transcript={flowTranscriptFallback}
                onRetry={retryHistory}
                onBack={onBack}
              />
            ) : historyState === "missing" ? (
              <ChatHistoryNotice
                title={flowBackedSession ? "Flow output unavailable" : "Chat history unavailable"}
                body={flowBackedSession
                  ? "This flow session exists, but CovenCave could not find saved chat history or flow output for it yet."
                  : "This session exists, but CovenCave could not find a saved transcript for it yet."}
                onRetry={retryHistory}
                onBack={onBack}
              />
            ) : historyState === "error" ? (
              <ChatHistoryNotice
                title="Could not load chat history"
                body="The transcript request failed. You can still continue this session."
                onRetry={retryHistory}
                onBack={onBack}
              />
            ) : (
              <ChatEmptyState
                familiar={familiar}
                onPrompt={(text) => {
                  setInput(text);
                  inputRef.current?.focus();
                }}
                onOpenPromptSnippets={() => setPromptSnippetsOpen(true)}
                projectId={projectIdDraft}
                onProjectChange={setProjectIdDraft}
                projects={projects}
                createProject={createProject}
                fileMentions={Boolean(mentionRoot)}
                sessionId={sessionId}
                sessions={sessions}
                linkedContext={linkedContext}
                daemonRunning={daemonRunning}
                modelId={
                  modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
                    ? modelState.effectiveModel
                    : familiar.model ?? null
                }
                taskArmed={taskArmed}
                onArmTask={armTask}
                onDisarmTask={disarmTask}
              />
            )
          ) : null}
          {(() => {
            // `groupedTurns` + `turnIndexMap` are memoized above (rebuilt only
            // when `activePath` changes, not on every keystroke). `allTurns`
            // feeds the per-row prev-turn timestamp-gap lookup and must match
            // the same sequence used for grouping.
            const allTurns = activePath;
            // Render cap (TRANSCRIPT_RENDER_CAP): while pinned to the bottom, only
            // mount the newest groups. The per-row prev-turn lookup still reads
            // the full `allTurns`/`turnIndexMap`, so the first visible row's
            // timestamp gap stays correct. Expands to the whole transcript the
            // moment the reader scrolls up or opens find (see historyExpanded).
            const renderGroups =
              historyExpanded || groupedTurns.length <= TRANSCRIPT_RENDER_CAP
                ? groupedTurns
                : groupedTurns.slice(-TRANSCRIPT_RENDER_CAP);
            return renderGroups.map((g) => {
              if (g.kind === "single") {
                const t = g.turn;
                const i = turnIndexMap.get(t.id) ?? -1;
                const prev = allTurns[i - 1];
                const showTimestamp = (() => {
                  if (!t.createdAt) return false;
                  if (!prev?.createdAt) return true;
                  const gap = new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime();
                  if (!Number.isFinite(gap)) return true;
                  if (gap >= 10 * 60 * 1000) return true;
                  return prev.role !== t.role;
                })();
                const singleBranchNav = (() => {
                  const { siblings, index } = siblingsFor(t.id);
                  if (siblings.length <= 1) return undefined;
                  return {
                    index,
                    total: siblings.length,
                    onPrev: () => void switchBranch(t.id, -1),
                    onNext: () => void switchBranch(t.id, 1),
                  };
                })();
                return (
                  <TurnRow
                    key={t.id}
                    turn={t}
                    familiar={familiar}
                    showTimestamp={showTimestamp}
                    found={foundTurnId === t.id}
                    onEdit={t.role === "user" && t.text.trim() ? () => editTurnInComposer(t) : undefined}
                    onRegenerate={regenerateFor(t)}
                    onReply={replyFor(t)}
                    onOpenUrl={onOpenUrl}
                    onSuggestion={(sug) => void send(sug)}
                    expanded={expandedAvatarTurnId === t.id}
                    onToggleAvatar={() => setExpandedAvatarTurnId((cur) => (cur === t.id ? null : t.id))}
                    branchNav={singleBranchNav}
                  />
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
                    const i = turnIndexMap.get(t.id) ?? -1;
                    const prev = allTurns[i - 1];
                    const showTimestamp = (() => {
                      if (!t.createdAt) return false;
                      if (!prev?.createdAt) return true;
                      const gap = new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime();
                      if (!Number.isFinite(gap)) return true;
                      if (gap >= 10 * 60 * 1000) return true;
                      return prev.role !== t.role;
                    })();
                    const groupBranchNav = (() => {
                      const { siblings, index } = siblingsFor(t.id);
                      if (siblings.length <= 1) return undefined;
                      return {
                        index,
                        total: siblings.length,
                        onPrev: () => void switchBranch(t.id, -1),
                        onNext: () => void switchBranch(t.id, 1),
                      };
                    })();
                    return (
                      <TurnRow
                        key={t.id}
                        turn={t}
                        familiar={familiar}
                        showTimestamp={showTimestamp}
                        found={foundTurnId === t.id}
                        onEdit={t.role === "user" && t.text.trim() ? () => editTurnInComposer(t) : undefined}
                        onRegenerate={regenerateFor(t)}
                        onReply={replyFor(t)}
                        onOpenUrl={onOpenUrl}
                        onSuggestion={(sug) => void send(sug)}
                        expanded={expandedAvatarTurnId === t.id}
                        onToggleAvatar={() => setExpandedAvatarTurnId((cur) => (cur === t.id ? null : t.id))}
                        branchNav={groupBranchNav}
                      />
                    );
                  })}
                </div>
              );
            });
          })()}
          {shouldShowChatArchiveNudge({
            taskLifecycle: linkedContext?.task?.lifecycle ?? null,
            sessionArchived: Boolean(session?.archived_at),
            dismissed: archiveNudgeDismissed,
          }) ? (
            <ChatArchiveNudge
              taskTitle={linkedContext?.task?.title ?? ""}
              onArchive={() => void archiveChat()}
              onDismiss={dismissArchiveNudge}
              archiving={archivingChat}
            />
          ) : null}
          {threadSignalReport ? (
            <ThreadSignalCard
              report={threadSignalReport}
              onDismiss={() => setThreadSignalReport(null)}
              onViewFull={() => {
                const params = new URLSearchParams({ sessionId: threadSignalReport.sessionId });
                window.location.href = `/dashboard/familiars/${encodeURIComponent(threadSignalReport.familiarId)}/analytics?${params.toString()}`;
              }}
            />
          ) : null}
          <div ref={tailRef} />
        </div>

        {/* Scroll-to-bottom FAB (CHAT-D10-03: shows count of new messages) */}
        {!following && (
          <button
            type="button"
            onClick={() => {
              updateFollowing(true);
              const el = scrollRef.current;
              if (!el) return;
              // CHAT-D13-03: the global `scroll-behavior: auto !important`
              // kill switch does NOT override explicit scrollTo options, so
              // gate the smooth animation on prefers-reduced-motion here.
              const reduceMotion =
                typeof window !== "undefined" &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
            }}
            aria-label={`Scroll to bottom${newTurnsCount ? ` (${newTurnsCount} new message${newTurnsCount !== 1 ? "s" : ""})` : ""}`}
            className="cave-scroll-bottom-button sticky bottom-4 ml-auto z-[60] flex h-7 w-7 items-center justify-center rounded-md border border-[var(--accent-presence)]/40 bg-[var(--bg-raised)] text-[var(--accent-presence)] shadow-[0_2px_12px_var(--accent-presence)/20] transition-all hover:border-[var(--accent-presence)]/70 hover:bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-raised))] hover:shadow-[0_2px_18px_var(--accent-presence)/35]"
            title={newTurnsCount ? `${newTurnsCount} new message${newTurnsCount !== 1 ? "s" : ""}` : undefined}
          >
            <Icon name="ph:caret-down-bold" width={12} />
            {newTurnsCount > 0 && <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-presence)] text-[10px] font-semibold text-[var(--accent-presence-foreground)]">{newTurnsCount}</span>}
          </button>
        )}
      </div>
      </ToolProjectRootContext.Provider>

      {reflectError ? (
        <div
          role="alert"
          className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_18%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{reflectError}</span>
          </span>
          <button
            type="button"
            onClick={() => setReflectError(null)}
            aria-label="Dismiss reflection error"
            className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </div>
      ) : null}

      {error ? (
        <ChatErrorStrip
          message={error}
          code={debugError?.code}
          errorSeq={debugError?.seq ?? 0}
          failingTurn={
            debugError?.turnId ? turns.find((t) => t.id === debugError.turnId) ?? null : null
          }
          canRetry={!!lastFailedSend}
          busy={busy}
          onRetry={retryLastSend}
          onOpenDebug={openDebug}
          addProjectLabel={
            projectAccessRoot ? `Add "${projectNameForRoot(projectAccessRoot)}" as project` : undefined
          }
          addingProject={addingProject}
          onAddProject={projectAccessRoot ? handleAddProject : undefined}
          onDismiss={() => {
            setError(null);
            setDebugError(null);
            setProjectAccessRoot(null);
          }}
        />
      ) : null}

      <footer
        className="cave-composer-dock"
        style={{ "--composer-kb-offset": `${keyboardOffset}px` } as React.CSSProperties}
      >
        <div className="cave-composer-shell">
          {mentionOpen ? (
            <div className="cave-composer-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
              <ul className="max-h-64 overflow-y-auto py-1" id={mentionListboxId} role="listbox" aria-label="Workspace files">
                {mentionMatches.map((file, i) => {
                  const active = i === mentionActiveIdx;
                  const base = file.split("/").pop() ?? file;
                  return (
                    <li
                      key={file}
                      role="option"
                      id={`${mentionListboxId}-opt-${i}`}
                      aria-selected={active}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeMentionOptionRef : null}
                        onMouseEnter={() => setMentionIdx(i)}
                        onClick={() => selectMention(file)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <Icon name="ph:file-code" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <span className="font-mono text-[var(--text-primary)]">{base}</span>
                        <span className="flex-1 truncate text-xs text-[var(--text-muted)]">{file}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {keys.up}{keys.down} navigate · {keys.enter} insert · Tab insert · esc cancel
              </div>
            </div>
          ) : null}
          {modelMenuActive && modelOptions ? (
            <div className="cave-composer-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
              <ul className="max-h-64 overflow-y-auto py-1" id={slashListboxId} role="listbox" aria-label="Models">
                {modelOptions.map((m, i) => {
                  const active = i === slashIdx;
                  return (
                    <li key={m.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeSlashOptionRef : null}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => {
                          handleSelectModel(m.id);
                          appendSystem(`Model set to ${m.id}.`);
                          setInput("");
                          inputRef.current?.focus();
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <span className="text-[var(--text-primary)]">{m.label}</span>
                        <span className="flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{m.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {keys.up}{keys.down} navigate · {keys.enter} switch · esc cancel
              </div>
            </div>
          ) : skillMenuActive && skillOptions ? (
            <div className="cave-composer-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
              <div className="flex">
              <ul className="max-h-64 flex-1 min-w-0 overflow-y-auto py-1" id={slashListboxId} role="listbox" aria-label="Skills">
                {skillOptions.map((s, i) => {
                  const active = i === slashIdx;
                  return (
                    <li key={s.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeSlashOptionRef : null}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => invokeSkillOption(s)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <Icon name="ph:sparkle" width={13} className="shrink-0 text-[var(--accent-presence)]" aria-hidden />
                        <span className="text-[var(--text-primary)]">{s.name}</span>
                        <span className="flex-1 truncate text-[11px] text-[var(--text-muted)]">
                          {s.description || s.id}
                        </span>
                        {s.argumentHint ? (
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            {s.argumentHint}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <SkillDetailPreview skill={skillOptions[slashIdx] ?? skillOptions[0] ?? null} />
              </div>
              <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {keys.up}{keys.down} navigate · {keys.enter} run · Tab complete · esc cancel
              </div>
            </div>
          ) : promptMenuActive && promptOptions ? (
            <div className="cave-composer-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
              <ul className="max-h-64 overflow-y-auto py-1" id={slashListboxId} role="listbox" aria-label="Prompts">
                {promptOptions.map((p, i) => {
                  const active = i === slashIdx;
                  return (
                    <li key={p.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeSlashOptionRef : null}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => insertPrompt(p)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <Icon name={promptIconName(p.icon)} width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <span className="text-[var(--text-primary)]">{p.name}</span>
                        <span className="flex-1 truncate text-[11px] text-[var(--text-muted)]">
                          {p.description || p.id}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {keys.up}{keys.down} navigate · {keys.enter} insert · Tab complete · esc cancel
              </div>
            </div>
          ) : slashSuggestions.length > 0 || skillCommandRows.length > 0 ? (
            <div className="cave-composer-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-xl">
              <ul className="max-h-64 overflow-y-auto py-1" id={slashListboxId} role="listbox" aria-label="Slash commands">
                {slashSuggestions.map((cmd, i) => {
                  const active = i === slashIdx;
                  return (
                    <li
                      key={cmd.name}
                      role="option"
                      id={`${slashListboxId}-opt-${i}`}
                      aria-selected={active}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeSlashOptionRef : null}
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
                {skillCommandRows.length > 0 ? (
                  <li role="presentation" className="mt-1 border-t border-[var(--border-hairline)] px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Skills
                  </li>
                ) : null}
                {skillCommandRows.map((s, i) => {
                  const idx = slashSuggestions.length + i;
                  const active = idx === slashIdx;
                  return (
                    <li key={`skill-${s.id}`} role="option" id={`${slashListboxId}-opt-${idx}`} aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        ref={active ? activeSlashOptionRef : null}
                        onMouseEnter={() => setSlashIdx(idx)}
                        onClick={() => invokeSkillOption(s)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]/50"
                        }`}
                      >
                        <Icon name="ph:sparkle" width={13} className="shrink-0 text-[var(--accent-presence)]" aria-hidden />
                        <span className="text-[var(--text-primary)]">{s.name}</span>
                        <span className="flex-1 truncate text-xs text-[var(--text-muted)]">
                          {s.description || s.id}
                        </span>
                        {s.argumentHint ? (
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            {s.argumentHint}
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
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-hairline)]/70 px-3 py-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-56 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/50 px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Icon name={attachmentIcon(attachment)} width={12} />
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
            {replyTarget ? (
              <div className="cave-composer-reply flex items-center gap-2 border-b border-[var(--border-hairline)]/70 bg-[var(--bg-raised)] px-3 py-1.5">
                <Icon name="ph:arrow-bend-up-left" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[11px]">
                  <span className="shrink-0 font-medium text-[var(--text-secondary)]">Replying to {replyTarget.author}</span>
                  <span className="truncate text-[var(--text-muted)]">{replyTarget.snippet}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  className="focus-ring grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
                  title="Cancel reply"
                  aria-label="Cancel reply"
                >
                  <Icon name="ph:x-bold" width={9} aria-hidden />
                </button>
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                syncComposerCaret(e);
              }}
              onKeyDown={onComposerKey}
              onKeyUp={syncComposerCaret}
              onClick={syncComposerCaret}
              onSelect={syncComposerCaret}
              onPaste={(e) => {
                // Paste-to-attach (CHAT-D1-02): clipboard files (screenshots,
                // copied images/files) win over any text payload riding along.
                // Only preventDefault when files were actually consumed so
                // plain-text paste — including the CSV sniff — is untouched.
                const pastedFiles = Array.from(e.clipboardData.items)
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
                if (pastedFiles.length > 0) {
                  e.preventDefault();
                  void attachFiles(pastedFiles);
                  return;
                }
              }}
              placeholder={busy ? "Streaming… (esc to cancel)" : `Message ${familiar.display_name}…  ↵ to send`}
              rows={1}
              inputMode="text"
              enterKeyHint="send"
              className="cave-composer-input w-full resize-none bg-transparent px-4 pt-3 pb-2 leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] md:text-sm"
              aria-label="Message"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? slashListboxId : undefined}
              aria-activedescendant={
                menuOpen ? `${slashListboxId}-opt-${slashIdx}` : undefined
              }
              {...mentionAriaOverrides}
            />
            {enhanceStatus !== "idle" ? (
              <div className="flex items-center gap-2 border-t border-[var(--border-hairline)]/60 px-3 py-1.5 text-[11px] text-[var(--text-muted)]" role="status">
                <Icon
                  name={enhanceStatus === "loading" ? "ph:arrow-clockwise" : enhanceStatus === "success" ? "ph:check" : "ph:warning-circle"}
                  width={12}
                  className={enhanceStatus === "loading" ? "animate-spin" : ""}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {enhanceStatus === "loading"
                    ? "Enhancing prompt..."
                    : enhanceStatus === "success"
                      ? "Prompt improved"
                      : "Prompt enhancement failed"}
                </span>
                {enhanceStatus === "success" && enhanceOriginal !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setInput(enhanceOriginal);
                      setEnhanceOriginal(null);
                      setEnhanceStatus("idle");
                      inputRef.current?.focus();
                    }}
                    className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                    aria-label="Revert prompt enhancement"
                    title="Revert prompt enhancement"
                  >
                    Revert
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="cave-composer-controls">
              <input
                ref={fileInputRef}
                type="file"
                accept={CHAT_ATTACHMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  // Snapshot the files and clear the input synchronously so picking the
                  // SAME file again still fires onChange (e.g. re-attach after the CSV
                  // or 10-attachment-cap early returns in attachFiles).
                  const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : null;
                  e.currentTarget.value = "";
                  void attachFiles(files);
                }}
              />
              <div className="cave-composer-control-row">
                <div className="cave-composer-utility-row">
                  <button
                    type="button"
                    className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]"
                    title="Attach images, videos, or files"
                    aria-label="Attach images, videos, or files"
                    disabled={busy || attachments.length >= 10}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon name="ph:paperclip" width={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
                    title="Voice"
                    aria-label="Voice"
                    disabled={!sessionId}
                    onClick={() => setVoiceCallOpen(true)}
                  >
                    <Icon name="ph:microphone" width={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]"
                    title="Prompt snippets"
                    aria-label="Prompt snippets"
                    onClick={() => setPromptSnippetsOpen(true)}
                  >
                    <Icon name="ph:chat-centered-text" width={14} aria-hidden />
                  </button>
                  <ComposerOptionsMenu
                    hostValue={composerHostValue}
                    onHostPick={setRuntimeHost}
                    disabled={busy}
                    indicator={
                      permissionMode !== DEFAULT_PERMISSION_MODE ||
                      thinkingEffort !== COMMAND_CONTROL_DEFAULTS.thinkingEffort ||
                      responseSpeed !== COMMAND_CONTROL_DEFAULTS.responseSpeed
                    }
                    sections={[
                      {
                        id: "access",
                        label: "Access",
                        value: permissionMode,
                        options: PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label })),
                        onChange: (v: string) => setPermissionMode(v as CommandPermissionMode),
                      } satisfies ComposerOptionSection,
                      ...(composerModelOptions.length > 0
                        ? [{
                            id: "model",
                            label: "Model",
                            value: composerModelValue,
                            options: composerModelOptions.map((m) => ({ value: m.id, label: m.label })),
                            onChange: (id: string) => handleSelectModel(id),
                          } satisfies ComposerOptionSection]
                        : []),
                      {
                        id: "thinking",
                        label: "Thinking",
                        value: thinkingEffort,
                        options: THINKING_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                        onChange: (v: string) => setThinkingEffort(v as ComposerThinkingEffort),
                      } satisfies ComposerOptionSection,
                      {
                        id: "speed",
                        label: "Speed",
                        value: responseSpeed,
                        options: SPEED_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                        onChange: (v: string) => setResponseSpeed(v as ComposerResponseSpeed),
                      } satisfies ComposerOptionSection,
                    ]}
                  />
                </div>
                <div className="cave-composer-submit-row">
                  <button
                    type="button"
                    className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
                    title="Enhance prompt"
                    aria-label="Enhance prompt"
                    disabled={busy || enhanceStatus === "loading" || !input.trim()}
                    onClick={() => void enhancePrompt()}
                  >
                    <Icon name="ph:sparkle" width={13} aria-hidden />
                  </button>
                  {busy ? (
                    <button
                      type="button"
                      onClick={cancelSend}
                      className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-danger)_90%,transparent)] text-white transition-colors hover:bg-[var(--color-danger)]"
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
                      className="cave-composer-icon-button focus-ring grid h-7 w-7 place-items-center rounded-md bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-40"
                      title={`Send message (${keys.enter})`}
                      aria-label="Send message"
                    >
                      <Icon name="ph:arrow-up-bold" width={13} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
      {voiceCallOpen && sessionId && (
        <VoiceCallOverlay
          familiar={familiar}
          sessionId={sessionId}
          onClose={() => setVoiceCallOpen(false)}
        />
      )}
      <PromptSnippetsModal
        open={promptSnippetsOpen}
        onClose={() => setPromptSnippetsOpen(false)}
        prompts={prompts}
        onPick={(p) => {
          setPromptSnippetsOpen(false);
          insertPrompt(p);
        }}
      />
      <Modal
        open={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        breadcrumb={["Chat", "Debug"]}
        ariaLabel="Session debug info"
      >
        <div className="h-[60vh] min-h-0">
          <DebugPane />
        </div>
      </Modal>
    </section>
  );
});

// ── TurnRow ────────────────────────────────────────────────────────────────────

// Split a prose run into ordered segments, replacing every complete renderable
// HTML/React fenced block with an inline ChatArtifactViewer. Text on either
// side of a block is preserved as markdown. Returns a single text segment when
// there's nothing renderable, so callers can detect "no artifacts".
function splitTextForArtifacts(
  text: string,
  ctx: { familiarId: string | null },
): MessageBubbleSegment[] {
  const blocks = extractArtifactBlocks(text);
  if (blocks.length === 0) return [{ kind: "text", text }];
  const out: MessageBubbleSegment[] = [];
  let cursor = 0;
  blocks.forEach((b, i) => {
    if (b.index > cursor) {
      const pre = text.slice(cursor, b.index);
      if (pre.trim()) out.push({ kind: "text", text: pre });
    }
    const preceding = text.slice(0, b.index).trim();
    const title = preceding ? titleFromPrompt(preceding) : "Canvas artifact";
    out.push({
      kind: "block",
      key: `artifact-${i}-${b.index}`,
      node: (
        <ChatArtifactViewer
          initialCode={b.code}
          kind={b.kind}
          title={title}
          familiarId={ctx.familiarId}
        />
      ),
    });
    cursor = b.index + b.length;
  });
  const tail = text.slice(cursor);
  if (tail.trim()) out.push({ kind: "text", text: tail });
  return out;
}

// CHAT-D3-07 perf: the implementation is memoized as `TurnRow` below, so a
// streamed token re-renders only the streaming row rather than every settled
// row in the thread (settled turns keep a stable `turn` reference because
// setTurns replaces just the changed turn). See `areTurnRowPropsEqual`.
function TurnRowImpl({
  turn,
  familiar,
  showTimestamp = true,
  found = false,
  onEdit,
  onRegenerate,
  onReply,
  onOpenUrl,
  expanded = false,
  onToggleAvatar,
  onSuggestion,
  branchNav,
}: {
  turn: Turn;
  onSuggestion?: (s: string) => void;
  familiar: Familiar;
  showTimestamp?: boolean;
  /** CHAT-D9-04: true while this turn is the just-jumped-to find match —
   *  applies the temporary cave-turn-found highlight flash. */
  found?: boolean;
  /** CHAT-D6-01: present only on user turns — loads the turn into the composer. */
  onEdit?: () => void;
  /** CHAT-D6-02: present only on settled assistant turns with a preceding user turn. */
  onRegenerate?: () => void;
  /** Reply to Chat: present on settled, non-empty turns of either role —
   *  stages this turn as the composer's quoted reply target. */
  onReply?: () => void;
  onOpenUrl?: (url: string) => void;
  expanded?: boolean;
  onToggleAvatar?: () => void;
  /** Branch navigator: shown when this turn has siblings (alternate branches). */
  branchNav?: { index: number; total: number; onPrev: () => void; onNext: () => void };
}) {
  // Tool activity renders inline while a turn streams (watching tools run IS the
  // live feedback). Once the turn settles, the prose is shown uninterrupted and
  // every tool call is collected into one designated, collapsed "Tool activity"
  // section below it (the ToolGroup) — so a familiar's response reads cleanly and
  // its tool usage is clearly separated rather than woven through the text.
  // Chat timestamp format (12h/24h clock + MM.DD/DD.MM/Off date) — a user
  // preference; the model/cwd/duration that used to sit here now live only in
  // the debug pane's per-turn JSON.
  const dtPrefs = useDateTimePrefs();

  // Click-away dismissal for the inline familiar card. Hooks are placed here
  // (before any early return) so React's rules-of-hooks are never violated.
  const avatarWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: PointerEvent) => {
      if (avatarWrapRef.current && !avatarWrapRef.current.contains(e.target as Node)) {
        onToggleAvatar?.();
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [expanded, onToggleAvatar]);

  // Focus management for the inline familiar card.
  // When the card opens, move focus to its close button; when it closes,
  // return focus to the avatar button that triggered it.
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const wasAvatarExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && !wasAvatarExpandedRef.current) {
      // opened → focus the card's first focusable (close button)
      const closeBtn = avatarWrapRef.current?.querySelector<HTMLElement>(".familiar-inline-card__close");
      closeBtn?.focus();
    } else if (!expanded && wasAvatarExpandedRef.current) {
      // closed → return focus to the avatar button
      avatarBtnRef.current?.focus();
    }
    wasAvatarExpandedRef.current = expanded;
  }, [expanded]);

  if (turn.role === "system" || turn.role === "user") {
    const recency = showTimestamp && turn.createdAt ? formatChatRecency(turn.createdAt, dtPrefs) : "";
    const exactTime = turn.createdAt ? formatTimestamp(turn.createdAt, dtPrefs) : "";
    return (
      <div
        data-turn-id={turn.id}
        className={`cave-linear-turn cave-linear-turn--${turn.role}${found ? " cave-turn-found" : ""}`}
      >
        <div className="cave-linear-turn-content cave-linear-turn-content--with-avatar">
          {turn.role === "user" ? (
            <UserChatAvatar className="cave-linear-turn-avatar cave-linear-turn-avatar--human" />
          ) : (
            <div className="cave-linear-turn-avatar cave-linear-turn-avatar--system" aria-hidden="true">
              <Icon name="ph:terminal-window" width={24} height={24} />
            </div>
          )}
          <div className="cave-linear-turn-right">
            <div className="cave-linear-turn-meta cave-linear-turn-meta--identity">
              <span className="cave-linear-turn-name">{turn.role === "user" ? "You" : "System"}</span>
              {turn.role === "user" ? (
                <span className="cave-linear-turn-badge cave-linear-turn-badge--op">OP</span>
              ) : null}
              {recency ? (
                <time className="cave-linear-turn-recency" dateTime={turn.createdAt} title={exactTime}>
                  {recency}
                </time>
              ) : null}
              {turn.attachments?.length ? <span className="cave-linear-turn-recency">{turn.attachments.length} file{turn.attachments.length === 1 ? "" : "s"}</span> : null}
            </div>
            <div className="cave-linear-turn-body">
              <MessageBubble
                role={turn.role}
                content={turn.text || (turn.attachments?.length ? "Attached files" : "")}
                timestamp={turn.createdAt}
                showTimestamp={false}
                pending={turn.pending}
                onEdit={onEdit}
                onReply={onReply}
                onOpenUrl={onOpenUrl}
                branchNav={branchNav}
              />
              {turn.attachments?.length ? <AttachmentList attachments={turn.attachments} /> : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Hide raw `coven:attachment` marker blocks from the live-streamed text. The
  // server strips them from the persisted text and streams the parsed files as
  // `attachment` events; this keeps the in-flight turn clean before reload.
  const reasoningSplit = splitReasoning(extractAgentAttachmentMarkers(turn.text).text);
  const inlineReasoning = reasoningSplit.reasoning;
  const { visible, suggestions: nextPaths } = extractNextPaths(reasoningSplit.visible);
  const reasoning = turn.reasoning?.trim() || inlineReasoning;
  const turnStatus = turn.lifecycle ?? (turn.error ? "failed" : turn.pending ? "streaming" : "complete");
  // CHAT-D12-01: while this turn's own live indicator is showing (pending, no
  // visible text yet), a Queued/Connecting/Writing chip in the same meta row
  // duplicates it — suppress the chip until text flows or the turn settles.
  // Settled chips never hit this (pending is false by then), so the Failed
  // chip that anchors the Retry pill (#416/#420) always renders.
  const indicatorVisible = Boolean(turn.pending) && !visible;

  // CHAT-D4-01: when every tool event carries a textOffset (live turns from
  // this session), render the turn as ordered segments — prose spans with
  // each tool call inline at its chronological position — instead of the
  // legacy "all text, then a trailing Tool activity rollup" stack that
  // inverted causality. Offsets were captured against the raw streamed text;
  // segmentTurn snaps them forward to fence-safe paragraph boundaries (and
  // clamps past-end offsets, e.g. when splitReasoning stripped thinking
  // markup), so a drifted offset degrades toward trailing — never a split
  // inside a code fence. Stored transcripts without offsets return null and
  // keep today's trailing ToolGroup.
  const segments = segmentTurn(visible, turn.tools);
  const bubbleSegments: MessageBubbleSegment[] | undefined = segments?.map((seg, i) =>
    seg.kind === "text"
      ? { kind: "text" as const, text: seg.text }
      : {
          kind: "block" as const,
          key: `tools-${seg.tools[0]?.id ?? i}`,
          // Reuse the EXISTING collapsed ToolBlock (arg summary + diff
          // inputs); same-offset tools render consecutively in one group.
          node: (
            <div className="space-y-2">
              {seg.tools.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
            </div>
          ),
        },
  );

  // Auto-detect renderable artifacts and inject the tabbed viewer. Applies to
  // SETTLED turns only (streaming shows plain code until the fence closes).
  const artifactCtx = { familiarId: familiar.id };

  let renderSegments: MessageBubbleSegment[] | undefined;
  if (turn.pending) {
    // Streaming: interleave tool blocks inline at their chronological offset so
    // you can watch them run as live feedback.
    renderSegments = bubbleSegments;
  } else {
    // Settled: prose only (+ artifact viewers). Tools are NOT woven into the
    // text — they render in the designated ToolGroup section below.
    const split = splitTextForArtifacts(visible, artifactCtx);
    renderSegments = split.some((s) => s.kind === "block") ? split : undefined;
  }

  // Per-turn provenance peek (see turnMetaPeekTitle): the model/cwd/duration
  // that used to sit inline here now live only in the debug pane, so a quiet
  // hover affordance brings them back for THIS turn on demand. Skipped while
  // streaming (the header MetaLine already narrates the live turn).
  const metaPeek = turn.pending ? null : turnMetaPeekTitle(turn);

  const recency = showTimestamp && turn.createdAt ? formatChatRecency(turn.createdAt, dtPrefs) : "";
  const exactTime = turn.createdAt ? formatTimestamp(turn.createdAt, dtPrefs) : "";

  return (
    <div
      data-turn-id={turn.id}
      className={`cave-linear-turn cave-linear-turn--assistant${found ? " cave-turn-found" : ""}`}
    >
      <div className="cave-linear-turn-content text-[14px] leading-relaxed text-[var(--text-primary)] group/turn">
        {/* Avatar (interactive) + right column */}
        <div className={`cave-linear-turn-avatar${expanded ? " is-selected" : ""}`} ref={avatarWrapRef}>
          <button
            ref={avatarBtnRef}
            type="button"
            className="cave-linear-turn-avatar-btn"
            aria-expanded={expanded}
            aria-controls={`familiar-card-${turn.id}`}
            aria-label={`Show ${familiar.display_name}'s details`}
            onClick={onToggleAvatar}
          >
            <FamiliarIcon familiar={familiar} size="xl" />
          </button>
          {expanded ? (
            <FamiliarInlineCard
              familiar={familiar}
              cardId={`familiar-card-${turn.id}`}
              onClose={() => onToggleAvatar?.()}
            />
          ) : null}
        </div>
        <div className="cave-linear-turn-right">
          <div className="cave-linear-turn-meta">
            <span className="cave-linear-turn-name">{familiar.display_name}</span>
            <span className="cave-linear-turn-crest" aria-hidden="true">
              <Icon name="ph:sparkle" width={13} height={13} />
            </span>
            {familiar.role ? (
              <span className="cave-linear-turn-badge">{familiar.role}</span>
            ) : null}
            {turnStatus !== "complete" && !indicatorVisible && (
              <span className={`cave-turn-status cave-turn-status--${turnStatus}`}>
                {lifecycleLabel(turnStatus)}
              </span>
            )}
            {/* CHAT-D12-03: a failed turn must offer retry WITHOUT hover — the
                bubble action row is hover-revealed (and absent entirely when
                the turn died with no text), and the lastFailedSend banner only
                covers transport errors. Same gated callback as Regenerate. */}
            {turn.error && onRegenerate ? (
              <button
                type="button"
                aria-label="Retry failed turn"
                title="Retry"
                onClick={onRegenerate}
                className="cave-turn-retry"
              >
                <Icon name="ph:arrow-clockwise" width={11} aria-hidden />
                Retry
              </button>
            ) : null}
            {recency ? (
              <time className="cave-linear-turn-recency" dateTime={turn.createdAt} title={exactTime}>
                {recency}
              </time>
            ) : null}
            <UsageText usage={turn.usage} costUsd={turn.costUsd} />
            {metaPeek ? (
              <span
                className="cave-turn-peek focus-ring"
                title={metaPeek}
                tabIndex={0}
                role="note"
                aria-label={`Turn details — ${metaPeek}`}
              >
                <Icon name="ph:info" width={11} aria-hidden />
              </span>
            ) : null}
          </div>

          <div className="cave-linear-turn-body">
            {indicatorVisible ? (
              <ThinkingIndicator label="Thinking" startedAt={turn.createdAt ? new Date(turn.createdAt).getTime() : undefined} />
            ) : (
              // `cave-artifact-content` scopes the comment-on-artifact text
              // selection to this turn's rendered markdown (see ArtifactComments).
              <div className="cave-artifact-content">
                <MessageBubble
                  role="assistant"
                  content={visible || (turn.pending ? "…" : "")}
                  timestamp={turn.createdAt}
                  showTimestamp={false}
                  pending={turn.pending}
                  isError={turn.error}
                  label={familiar.display_name}
                  messageId={turn.id}
                  feedbackContext={{ familiarId: familiar.id }}
                  onRegenerate={onRegenerate}
                  onReply={onReply}
                  onOpenUrl={onOpenUrl}
                  // CHAT-D13-01: with tools hidden, fall back to plain content —
                  // the text segments concatenate to `visible` anyway, so prose
                  // renders identically with the tool blocks omitted.
                  segments={renderSegments}
                  branchNav={branchNav}
                />
              </div>
            )}
            {/* CHAT-D4-01: tools often run BEFORE the first prose chunk
                (research-style turns) — show them inline immediately so
                they don't teleport out of a rollup once text arrives. */}
            {indicatorVisible && segments?.length ? (
              <div className="mt-3 space-y-2">
                {segments.flatMap((seg) =>
                  seg.kind === "tools"
                    ? seg.tools.map((tool) => <ToolBlock key={tool.id} tool={tool} />)
                    : [],
                )}
              </div>
            ) : null}
            {/* Agent-produced inline attachments (file chips → lightbox). */}
            {turn.attachments?.length ? <AttachmentList attachments={turn.attachments} /> : null}
            {turn.progress?.length ? <ProgressGroup progress={turn.progress} pending={!!turn.pending} /> : null}
            {reasoning ? <ReasoningBlock reasoning={reasoning} durationMs={turn.durationMs} /> : null}
            {/* Designated "Tool activity" section on settled turns. Codex
                file-edit cards (Edit/Write/etc. with a target file) stay VISIBLE
                inline — they're the actionable output (Review/Undo), so they must
                not be buried in the collapsed rollup. All OTHER tool activity
                (reads, greps, bash, …) collapses into the ToolGroup below the
                prose. Streaming turns weave tools inline instead — see
                renderSegments. */}
            {!turn.pending && turn.tools?.length
              ? (() => {
                  const isEditCard = (t: ToolEvent) =>
                    toolInputAsDiff(t.name, t.input) != null;
                  const editCards = turn.tools.filter(isEditCard);
                  const otherTools = turn.tools.filter((t) => !isEditCard(t));
                  return (
                    <>
                      {editCards.length ? (
                        <div className="cave-edit-cards mt-3 space-y-2">
                          {editCards.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
                        </div>
                      ) : null}
                      {otherTools.length ? <ToolGroup tools={otherTools} /> : null}
                    </>
                  );
                })()
              : null}
            {/* Suggested follow-ups render LAST — they're the most actionable
                element (click to send), so they sit closest to the composer and
                aren't pushed up the turn by the tool-activity section. */}
            {nextPaths.length > 0 && !turn.pending ? (
              <div className="cave-next-paths">
                {nextPaths.map((s, i) => {
                  // The agent lists next steps best-first, so flag the top one as
                  // the recommendation (green pulsing border + leading dot).
                  const recommended = i === 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`cave-next-path${recommended ? " cave-next-path--recommended" : ""}`}
                      onClick={() => onSuggestion?.(s)}
                      aria-label={recommended ? `Recommended: ${s}` : undefined}
                      title={recommended ? "Recommended next step" : undefined}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* Comment on the markdown artifact this turn produced: select any
                passage above to leave a comment, then request a revision that
                sends every comment back to the agent. Settled, substantial
                assistant turns only (skip tiny replies and errors). */}
            {!turn.pending && !turn.error && visible.trim().length > 80 ? (
              <ArtifactComments
                turnId={turn.id}
                familiarName={familiar.display_name}
                onRequest={(prompt) => onSuggestion?.(prompt)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReasoningBlock({ reasoning, durationMs }: { reasoning: string; durationMs?: number }) {
  // The global "Show thinking" toggle (header) opens every reasoning block at
  // once; an individual block can still be collapsed/expanded locally. The
  // disclosure stays default-collapsed in markup — `open` is driven by the
  // shared preference so toggling it re-opens blocks that were never touched.
  const [showThinking] = useShowThinking();
  const wordCount = useMemo(
    () => reasoning.split(/\s+/).filter(Boolean).length,
    [reasoning],
  );
  return (
    <details
      className="cave-reasoning-block mt-3"
      data-default-collapsed="true"
      open={showThinking || undefined}
    >
      <summary className="cave-tool-summary">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="ph:brain" width={12} aria-hidden />
          Thinking
        </span>
        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-[var(--text-muted)]">
          {typeof durationMs === "number" && durationMs > 0
            ? `Worked for ${fmtDuration(durationMs)}`
            : `${wordCount} ${wordCount === 1 ? "word" : "words"}`}
        </span>
      </summary>
      <div className="cave-reasoning-body mt-2 border-t border-[var(--border-hairline)]/70 pt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        <RichText text={reasoning} />
      </div>
    </details>
  );
}

/** The step to surface as "what's happening now": the most recent running
 *  event, else the last event. Shared by ProgressGroup and RunActivityStrip. */
function currentProgress(progress: ProgressEvent[]): ProgressEvent | undefined {
  return (
    [...progress].reverse().find((event) => event.status === "running") ??
    progress[progress.length - 1]
  );
}

function ProgressGroup({
  progress,
  pending,
}: {
  progress: ProgressEvent[];
  pending: boolean;
}) {
  const running = progress.filter((event) => event.status === "running").length;
  const errors = progress.filter((event) => event.status === "error").length;
  const completed = progress.length - running - errors;
  const current = currentProgress(progress);

  return (
    <details className="cave-progress-group mt-3" data-default-collapsed="true" open={pending || undefined}>
      <summary className="cave-tool-summary">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="ph:list-checks-bold" width={12} aria-hidden />
          Progress
        </span>
        {current ? (
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)] normal-case tracking-normal" title={current.label}>
            {current.label}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] normal-case tracking-normal text-[var(--text-muted)]">
          {running ? <span className="cave-tool-count cave-tool-count--running">{running} running</span> : null}
          {errors ? <span className="cave-tool-count cave-tool-count--error">{errors} {errors === 1 ? "issue" : "issues"}</span> : null}
          {completed ? <span className="cave-tool-count">{completed} done</span> : null}
        </span>
      </summary>
      <div className="cave-progress-list">
        {progress.map((event) => (
          <ProgressRow key={event.id} event={event} />
        ))}
      </div>
    </details>
  );
}

// A single progress step. Its `detail` (often a long file path or tool call)
// truncates inline; clicking it expands a full, wrapped, selectable panel below
// the row so the cut-off text can actually be read on desktop and touch alike.
// `title` keeps a hover tooltip as a fallback.
function ProgressRow({ event }: { event: ProgressEvent }) {
  const [open, setOpen] = useState(false);
  const statusIcon =
    event.status === "error"
      ? "ph:warning-circle"
      : event.status === "done"
        ? "ph:check-circle"
        : "ph:circle-dashed";
  return (
    <div>
      <div className={`cave-progress-row cave-progress-row--${event.status}`}>
        <Icon name={statusIcon} width={12} aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={event.label}>{event.label}</span>
        {event.detail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? "Hide detail" : event.detail}
            className="focus-ring inline-flex min-w-0 max-w-[18rem] items-center gap-1 truncate rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            <span className="truncate">{event.detail}</span>
            <Icon
              name="ph:caret-down"
              width={9}
              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        ) : null}
        <DurationText durationMs={event.durationMs} />
      </div>
      {open && event.detail ? (
        <div className="mt-1 ml-5 whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
          {event.detail}
        </div>
      ) : null}
    </div>
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
          {errors ? <span className="cave-tool-count cave-tool-count--error">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
          {completed ? <span className="cave-tool-count">{completed} done</span> : null}
        </span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-[var(--border-hairline)]/70 pt-2">
        {tools.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
      </div>
    </details>
  );
}

// The active session's project root, provided by ChatView so the inline edit
// card can convert an absolute target path into the repo-relative path that the
// `/api/changes` revert endpoint requires — without prop-threading through the
// five ToolBlock/ToolGroup render sites.
const ToolProjectRootContext = createContext<string | null>(null);

// Review + Undo actions for the Codex-style inline edit card. Review adapts to
// where the edit can actually be reviewed: a file under the session's project
// root jumps to its diff in the code rail's Changes panel (cumulative diff +
// checkpoint/undo tools); anything else — familiar-workspace docs, repo-less
// sessions, relative paths — opens an in-chat modal with this edit's diff, so
// the button never lands on an empty Changes list or silently does nothing.
// Undo reverts the edited file to its last committed state via `/api/changes`
// (which auto-snapshots the tree to a checkpoint first, so the revert is
// itself recoverable). Undo requires a two-step arm→confirm to avoid an
// accidental one-click revert, and is only offered when the target resolves to
// a repo-relative path under the project root.
function EditCardActions({
  targetFile,
  diff,
  displayPath,
}: {
  targetFile: string | null;
  diff: string;
  displayPath: string;
}) {
  const projectRoot = useContext(ToolProjectRootContext);
  const relPath =
    projectRoot && targetFile && targetFile.startsWith(projectRoot)
      ? targetFile.slice(projectRoot.length).replace(/^\/+/, "")
      : null;
  const [state, setState] = useState<"idle" | "armed" | "reverting" | "reverted" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const base = displayPath.split("/").pop() || displayPath;

  const review = () => {
    if (relPath && targetFile) {
      window.dispatchEvent(new CustomEvent("cave:open-file-diff", { detail: { path: targetFile } }));
    } else {
      setReviewOpen(true);
    }
  };

  const doUndo = async () => {
    if (!projectRoot || !relPath) return;
    setState("reverting");
    setErr(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot, path: relPath, confirmUntracked: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `revert failed (${res.status})`);
      setState("reverted");
      window.dispatchEvent(new CustomEvent("cave:changes-refresh"));
    } catch (e) {
      setErr((e as Error)?.message ?? "revert failed");
      setState("error");
    }
  };

  return (
    <span className="cave-edit-card__actions" onClick={(e) => e.stopPropagation()}>
      {err ? <span className="cave-edit-card__error" title={err}>{err}</span> : null}
      <button
        type="button"
        className="cave-edit-card__review focus-ring"
        onClick={review}
        title={
          relPath
            ? "Review this file's pending diff in the Changes panel"
            : "Review this edit's diff"
        }
      >
        Review
      </button>
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        breadcrumb={["Review", base]}
        wide
      >
        <div className="cave-review-modal">
          <p className="cave-review-modal__path" title={displayPath}>
            {displayPath}
          </p>
          <SyntaxBlock text={diff} lang="diff" />
        </div>
      </Modal>
      {relPath ? (
        state === "reverted" ? (
          <span className="cave-edit-card__reverted">Reverted</span>
        ) : state === "reverting" ? (
          <button type="button" className="cave-edit-card__undo focus-ring" disabled>
            Undoing…
          </button>
        ) : state === "armed" ? (
          <>
            <button type="button" className="cave-edit-card__undo focus-ring" onClick={() => setState("idle")}>
              Cancel
            </button>
            <button type="button" className="cave-edit-card__undo cave-edit-card__undo--confirm focus-ring" onClick={doUndo}>
              Confirm undo
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cave-edit-card__undo focus-ring"
            onClick={() => setState("armed")}
            title="Revert this file to its last committed state (a checkpoint is saved first)"
          >
            Undo
          </button>
        )
      ) : null}
    </span>
  );
}

function ToolBlock({ tool }: { tool: ToolEvent }) {
  const argSummary = toolArgSummary(tool.name, tool.input);
  // CHAT-D8-02: Edit/Write/MultiEdit/NotebookEdit inputs render as a
  // structured before/after diff instead of the raw JSON payload; null for
  // every other tool (or unparseable input) falls back to the plain block.
  const inputDiff = toolInputAsDiff(tool.name, tool.input);
  const targetPath = toolTargetPath(tool.name, tool.input);
  // Click-to-open: a file tool's target opens in the Code workspace preview.
  // Dispatched as an event; the comux pane (Code/Terminal) handles it, and the
  // workspace switches to Code mode first when neither is showing.
  const targetFile = toolTargetFile(tool.name, tool.input);
  // An edit tool (Edit/Write/MultiEdit/NotebookEdit — the ones with a structured
  // input diff) jumps to its file's DIFF in the Changes review; other file tools
  // open the file preview. The comux pane handles both events.
  const isEditTool = inputDiff != null;
  const openTargetFile = (e: ReactMouseEvent) => {
    if (!targetFile) return;
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent(isEditTool ? "cave:open-file-diff" : "cave:open-project-file", {
        detail: { path: targetFile },
      }),
    );
  };
  const visual = toolVisual(tool.name);
  // Codex-style inline edit card: a mutation tool (Edit/Write/MultiEdit/
  // NotebookEdit, i.e. `isEditTool`) stays visible in the transcript as a
  // compact details summary, and expands to the structured code diff. Review
  // opens the comux diff when the input carries an absolute target path.
  if (isEditTool) {
    const stat = diffStat(inputDiff ?? "");
    const displayPath = targetPath ?? (argSummary || tool.name);
    const base = displayPath.split("/").pop() || displayPath;
    return (
      <details className="cave-tool-block cave-edit-card" data-default-collapsed="true" data-tool-category={visual.category}>
        <summary className="cave-edit-card__summary">
          <Icon name="ph:pencil-simple" width={16} className="cave-edit-card__icon" aria-hidden />
          <span className="cave-edit-card__body">
            <span className="cave-edit-card__title">Edited {base}</span>
            <span className="cave-edit-card__stat">
              <span className="cave-edit-card__ins">+{stat.insertions}</span>{" "}
              <span className="cave-edit-card__del">−{stat.deletions}</span>
            </span>
          </span>
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
          <DurationText durationMs={tool.durationMs} />
          <EditCardActions targetFile={targetFile} diff={inputDiff ?? ""} displayPath={displayPath} />
        </summary>
        <div className="cave-tool-io mt-2">
          <div className="cave-tool-io-label">Code changes</div>
          <SyntaxBlock text={inputDiff} lang="diff" />
        </div>
        {tool.output ? (
          <div className="cave-tool-io mt-2">
            <div className="cave-tool-io-label">Output</div>
            <SyntaxBlock text={prettyToolOutput(tool.output)} />
          </div>
        ) : null}
      </details>
    );
  }
  return (
    <details className="cave-tool-block" data-default-collapsed="true" data-tool-category={visual.category}>
      <summary className="flex min-w-0 cursor-pointer select-none flex-wrap items-center gap-2 text-[11px]">
        <Icon name={visual.icon} width={12} className="cave-tool-icon shrink-0" aria-hidden />
        <span className="cave-tool-name min-w-0 truncate font-mono">{tool.name}</span>
        {argSummary ? (
          targetFile ? (
            <button
              type="button"
              onClick={openTargetFile}
              title={isEditTool ? `View diff for ${targetFile}` : `Open ${targetFile} in the Code workspace`}
              className="group/openfile inline-flex min-w-0 max-w-[18rem] items-center gap-1 truncate font-mono text-[var(--text-muted)] hover:text-[var(--accent-presence,var(--text-secondary))] hover:underline"
            >
              <span className="truncate">· {argSummary}</span>
              <Icon name={isEditTool ? "ph:git-diff" : "ph:arrow-square-out"} width={10} className="shrink-0 opacity-0 transition-opacity group-hover/openfile:opacity-100" aria-hidden />
            </button>
          ) : (
            <span className="min-w-0 max-w-[18rem] truncate font-mono text-[var(--text-muted)]">· {argSummary}</span>
          )
        ) : null}
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
        <DurationText durationMs={tool.durationMs} />
      </summary>
      {tool.input ? (
        <div className="cave-tool-io mt-2">
          <div className="cave-tool-io-label">Input</div>
          {inputDiff ? (
            <SyntaxBlock text={inputDiff} lang="diff" />
          ) : (
            <ToolInputView input={tool.input} />
          )}
        </div>
      ) : null}
      {tool.output ? (
        <div className="cave-tool-io mt-2">
          <div className="cave-tool-io-label">Output</div>
          <SyntaxBlock text={prettyToolOutput(tool.output)} />
        </div>
      ) : null}
    </details>
  );
}

/**
 * Readable tool input: a labelled field list (`File: …`, `Find: …`) derived
 * from the JSON payload, with the raw JSON one toggle away for auditing. Falls
 * back to the raw SyntaxBlock when the payload is not a JSON object (bare
 * command lines, arrays, truncated blobs).
 */
function ToolInputView({ input }: { input: string }) {
  const fields = useMemo(() => toolReadableFields(input), [input]);
  const [showRaw, setShowRaw] = useState(false);
  if (!fields) return <SyntaxBlock text={input} />;
  return (
    <div className="cave-tool-input">
      {showRaw ? <SyntaxBlock text={input} /> : <ToolFieldList fields={fields} />}
      <button
        type="button"
        className="cave-tool-raw-toggle focus-ring"
        aria-pressed={showRaw}
        onClick={() => setShowRaw((v) => !v)}
      >
        <Icon name={showRaw ? "ph:list-bullets" : "ph:code"} width={11} aria-hidden />
        {showRaw ? "Readable" : "Raw JSON"}
      </button>
    </div>
  );
}

function ToolFieldList({ fields }: { fields: ReadableField[] }) {
  return (
    <dl className="cave-tool-fields">
      {fields.map((field) => (
        <div
          key={field.key}
          className="cave-tool-field"
          data-kind={field.kind}
          data-multiline={field.multiline ? "true" : undefined}
        >
          <dt className="cave-tool-field-label">{field.label}</dt>
          <dd className="cave-tool-field-value">
            {field.multiline ? (
              <SyntaxBlock text={field.value} lang={field.kind === "json" ? "json" : undefined} />
            ) : (
              <span className="cave-tool-field-inline">{field.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type TurnRowProps = Parameters<typeof TurnRowImpl>[0];

/**
 * Memo comparator for {@link TurnRow}. Callback props are recreated on every
 * parent render (e.g. `onRegenerate={regenerateFor(t)}`), so comparing them by
 * identity would defeat memoization entirely. Instead we compare the stable
 * data (`turn` ref, familiar, the booleans) and the *presence* of each action —
 * the Edit / Regenerate / Reply buttons appear and disappear based on whether
 * the callback is defined (e.g. Regenerate hides while busy), and that flip is
 * what a row must re-render for. Returns true to skip the re-render.
 */
function areTurnRowPropsEqual(prev: TurnRowProps, next: TurnRowProps): boolean {
  return (
    prev.turn === next.turn &&
    prev.familiar === next.familiar &&
    prev.showTimestamp === next.showTimestamp &&
    prev.found === next.found &&
    prev.expanded === next.expanded &&
    Boolean(prev.onEdit) === Boolean(next.onEdit) &&
    Boolean(prev.onRegenerate) === Boolean(next.onRegenerate) &&
    Boolean(prev.onReply) === Boolean(next.onReply) &&
    // Branch nav: compare by index+total (the displayed position changes when
    // branches are added); skip closure identity — callbacks are recreated on
    // every parent render and would defeat memoization.
    prev.branchNav?.index === next.branchNav?.index &&
    prev.branchNav?.total === next.branchNav?.total
  );
}

const TurnRow = memo(TurnRowImpl, areTurnRowPropsEqual);

function AttachmentLightbox({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const isImage = (attachment.mimeType ?? attachment.type)?.startsWith("image/");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // CHAT-D11-02: shared focus trap — focuses the first control on open,
  // cycles Tab/Shift+Tab inside the dialog, closes on Escape, and restores
  // focus to the attachment-chip trigger on close. Always active: this
  // component only mounts while the lightbox is open.
  useFocusTrap(true, dialogRef, { onEscape: onClose });
  // Portal to <body> so the overlay escapes the chat transcript's containing
  // blocks (`.cave-mode-fade` sets `transform`; `.cave-linear-turn` sets
  // `content-visibility: auto`) — both trap `position: fixed`, which would
  // otherwise clamp this lightbox to the message's turn box instead of the
  // full viewport. See ui/modal.tsx for the same pattern.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="relative max-h-[90vh] w-[90vw] max-w-screen-2xl overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${attachment.name}`}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/60 px-4 py-2.5">
          <Icon name={attachmentIcon(attachment)} width={13} className="shrink-0 text-[var(--text-muted)]" />
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
    </div>,
    document.body,
  );
}

/**
 * Persistent run-activity strip (pinned above the transcript). Surfaces what the
 * agent is doing *now* — the running tool (with its arg summary) or current
 * plan/todo step, plus running/done/issue counts — and, unlike the inline
 * per-turn ProgressGroup (hidden after settle, CHAT-D13-01), keeps a compact,
 * dismissible "last run" summary after the turn settles. Click to expand the
 * full ProgressGroup + tool list. Reads live turn data directly, so it works for
 * both segmented and legacy turns.
 */
function RunActivityStrip({
  activeTurn,
  lastTurn,
}: {
  activeTurn: Turn | undefined;
  lastTurn: Turn | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const panelId = useId();
  const live = !!activeTurn;
  const turn = activeTurn ?? lastTurn;
  if (!turn) return null;
  if (!live && dismissedId === turn.id) return null;

  const tools = turn.tools ?? [];
  const progress = turn.progress ?? [];
  if (tools.length === 0 && progress.length === 0) return null;

  const runningTool = [...tools].reverse().find((t) => t.status === "running");
  const runningToolDetail = live && runningTool ? toolArgDetail(runningTool.name, runningTool.input) : "";
  const step = currentProgress(progress);
  const running =
    tools.filter((t) => t.status === "running").length +
    progress.filter((p) => p.status === "running").length;
  const issues =
    tools.filter((t) => t.status === "error").length +
    progress.filter((p) => p.status === "error").length;
  const done =
    tools.filter((t) => t.status === "ok").length +
    progress.filter((p) => p.status === "done").length;

  let headline: string;
  if (live && runningTool) {
    const arg = toolArgSummary(runningTool.name, runningTool.input);
    headline = arg ? `${runningTool.name} · ${arg}` : runningTool.name;
  } else if (live) {
    headline = step?.label ?? "Working…";
  } else {
    headline = step?.label ?? "Last run";
  }

  return (
    <div className="cave-run-activity shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-base)]/60 px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={live ? "Agent activity (running)" : "Last run summary"}
        >
          <Icon
            name={live ? "ph:circle-dashed" : issues ? "ph:warning-circle" : "ph:check-circle"}
            width={13}
            className={`shrink-0 ${live ? "animate-spin text-[var(--accent-presence)]" : issues ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{headline}</span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
            {running ? <span className="cave-tool-count cave-tool-count--running">{running} running</span> : null}
            {issues ? <span className="cave-tool-count cave-tool-count--error">{issues} {issues === 1 ? "issue" : "issues"}</span> : null}
            {done ? <span className="cave-tool-count">{done} done</span> : null}
          </span>
          <Icon name={expanded ? "ph:caret-up" : "ph:caret-down"} width={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
        </button>
        {!live ? (
          <button
            type="button"
            onClick={() => setDismissedId(turn.id)}
            className="shrink-0 rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
            aria-label="Dismiss last run summary"
          >
            <Icon name="ph:x" width={11} aria-hidden />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div id={panelId} className="mt-1.5">
          {progress.length ? <ProgressGroup progress={progress} pending={live} /> : null}
          {tools.length ? <ToolGroup tools={tools} /> : null}
        </div>
      ) : live && runningTool && runningToolDetail ? (
        <div className="cave-run-activity-context" title={`${runningTool.name}(${runningToolDetail})`}>
          <span className="cave-run-activity-context__tool">{runningTool.name}</span>({runningToolDetail})
        </div>
      ) : null}
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
            <Icon name={attachmentIcon(attachment)} width={12} className="shrink-0 text-[var(--text-muted)]" />
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
