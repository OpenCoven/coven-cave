"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BottomTerminal } from "@/components/bottom-terminal";
import { Icon } from "@/lib/icon";
import { ProjectTree, type ProjectTreeHandle } from "@/components/project-tree";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import {
  deriveComuxProjects,
  projectName,
  type ComuxProject,
} from "@/lib/comux-projects";
import type { SessionRow } from "@/lib/types";

type ComuxViewMode = "terminal" | "projects";

type TerminalSession = {
  id: string;
  label: string;
  projectRoot?: string;
};

type SplitDirection = "horizontal" | "vertical";
type SplitSide = "left" | "right" | "top" | "bottom";
type SessionPlacement = "replace" | "split";

type Props = {
  view: ComuxViewMode;
  sessions: SessionRow[];
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onNewChat: (projectRoot: string) => void;
  active?: boolean;
};

type ProjectFilePreview =
  | { kind: "text"; content: string; size?: number }
  | { kind: "image"; dataUrl: string; mimeType: string; size?: number };

const STORAGE_SESSIONS = "cave:comux:sessions";
const TERMINAL_SESSION_DRAG_TYPE = "application/x-cave-terminal-session";

function uniqueSessionIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

function directionForSplitSide(side: SplitSide): SplitDirection {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

function insertPaneSession(
  paneIds: string[],
  sourceSessionId: string,
  targetSessionId: string | undefined,
  side: SplitSide,
): string[] {
  if (!targetSessionId || sourceSessionId === targetSessionId) {
    return uniqueSessionIds(paneIds.length ? paneIds : [sourceSessionId]);
  }
  const base = uniqueSessionIds(paneIds).filter((id) => id !== sourceSessionId);
  const targetIdx = base.indexOf(targetSessionId);
  if (targetIdx === -1) return uniqueSessionIds([...base, sourceSessionId]);
  const insertIdx = side === "left" || side === "top" ? targetIdx : targetIdx + 1;
  return [
    ...base.slice(0, insertIdx),
    sourceSessionId,
    ...base.slice(insertIdx),
  ];
}

function TerminalDropZone({
  side,
  onSplit,
}: {
  side: SplitSide;
  onSplit: (sessionId: string, side: SplitSide) => void;
}) {
  const [over, setOver] = useState(false);

  const acceptsTerminalSession = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes(TERMINAL_SESSION_DRAG_TYPE);

  return (
    <div
      className={`comux-terminal-drop-zone comux-terminal-drop-zone--${side}${over ? " comux-terminal-drop-zone--over" : ""}`}
      data-drop-side={side}
      aria-hidden="true"
      onDragEnter={(e) => {
        if (!acceptsTerminalSession(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!acceptsTerminalSession(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!acceptsTerminalSession(e)) return;
        e.preventDefault();
        setOver(false);
        const dragged = e.dataTransfer.getData(TERMINAL_SESSION_DRAG_TYPE);
        if (!dragged) return;
        onSplit(dragged, side);
      }}
    />
  );
}

function readSessions(): TerminalSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is TerminalSession =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).id === "string" &&
        typeof (s as Record<string, unknown>).label === "string",
    ).map((s) => ({
      id: s.id,
      label: s.label,
      projectRoot:
        typeof (s as Record<string, unknown>).projectRoot === "string"
          ? ((s as Record<string, unknown>).projectRoot as string)
          : undefined,
    }));
  } catch {
    return [];
  }
}

function uid(): string {
  return crypto.randomUUID();
}

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);
function isMarkdownPath(path: string | null): boolean {
  if (!path) return false;
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && MARKDOWN_EXTS.has(ext));
}

function formatBytes(bytes: number | undefined): string | null {
  if (typeof bytes !== "number" || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortProjectTime(iso: string | null): string {
  if (!iso) return "No sessions yet";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
    const days = Math.round(diffSec / 86400);
    if (days < 30) return `${days}d ago`;
    return `${Math.round(days / 30)}mo ago`;
  } catch {
    return "No sessions yet";
  }
}

export function ComuxView({ view, sessions: daemonSessions, onOpenSession, onNewChat, active = true }: Props) {
  const [sessions, setSessions] = useState<TerminalSession[]>(readSessions);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [paneSessionIds, setPaneSessionIds] = useState<string[]>([]);
  const [splitDirection, setSplitDirection] = useState<SplitDirection>("horizontal");

  // Project tab state
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewRaw, setPreviewRaw] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const treeRef = useRef<ProjectTreeHandle | null>(null);

  // Daemon project root — forwarded to BottomTerminal so terminals open in
  // the right CWD instead of the app bundle dir.
  const [daemonProjectRoot, setDaemonProjectRoot] = useState<string | undefined>(undefined);
  const [selectedProjectRoot, setSelectedProjectRoot] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as Record<string, unknown>;
        const root =
          (json.workspacePath as string | undefined) ??
          (json.projectRoot as string | undefined);
        if (root && typeof root === "string") {
          setDaemonProjectRoot(root);
        }
      } catch {
        // non-fatal — terminal will open in default shell dir
      }
    })();
  }, []);

  // Persist sessions
  useEffect(() => {
    window.localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    setPaneSessionIds((prev) => {
      if (sessions.length === 0) return [];
      const validIds = new Set(sessions.map((session) => session.id));
      const filtered = uniqueSessionIds(prev.filter((id) => validIds.has(id)));
      if (filtered.length > 0) return filtered;
      return [sessions[Math.min(currentIdx, sessions.length - 1)]?.id ?? sessions[0].id];
    });
  }, [currentIdx, sessions]);

  const projects = useMemo(
    () => deriveComuxProjects(daemonSessions, daemonProjectRoot),
    [daemonSessions, daemonProjectRoot],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.root === selectedProjectRoot) ?? projects[0] ?? null,
    [projects, selectedProjectRoot],
  );

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectRoot(undefined);
      return;
    }
    setSelectedProjectRoot((current) =>
      current && projects.some((project) => project.root === current)
        ? current
        : projects[0].root,
    );
  }, [projects]);

  const addSession = useCallback((rootOverride?: string, placement: SessionPlacement = "replace") => {
    const id = uid();
    const root = rootOverride ?? selectedProjectRoot ?? daemonProjectRoot;
    const activeSessionId = sessions[currentIdx]?.id;
    setSessions((prev) => {
      const next = [
        ...prev,
        {
          id,
          label: root ? `${projectName(root)} ${prev.length + 1}` : `Terminal ${prev.length + 1}`,
          projectRoot: root,
        },
      ];
      setCurrentIdx(next.length - 1);
      return next;
    });
    setPaneSessionIds((prev) => {
      if (placement === "split") return uniqueSessionIds([...prev, id]);
      if (prev.length === 0) return [id];
      const target = activeSessionId && prev.includes(activeSessionId)
        ? activeSessionId
        : prev[0];
      return prev.map((paneId) => (paneId === target ? id : paneId));
    });
    return id;
  }, [currentIdx, daemonProjectRoot, selectedProjectRoot, sessions]);

  const removeSession = useCallback(
    (idx: number) => {
      setSessions((prev) => {
        const removedId = prev[idx]?.id;
        const next = prev.filter((_, i) => i !== idx);
        if (removedId) {
          setPaneSessionIds((panes) => panes.filter((id) => id !== removedId));
          // Closing a tab is the ONLY place a desktop PTY is killed. The
          // terminal component deliberately does not stop the shell on
          // unmount — tab switches remount terminals through the keepalive
          // container, and killing there raced the next mount's liveness
          // check, leaving a dead pane that ate keystrokes.
          const internals = (window as unknown as Record<string, unknown>)
            .__TAURI_INTERNALS__;
          if (internals) {
            void import("@tauri-apps/api/core")
              .then(({ invoke }) =>
                invoke("pty_stop", { threadId: `cave.comux.${removedId}` }),
              )
              .catch(() => {});
          }
        }
        setCurrentIdx((ci) => {
          if (next.length === 0) return 0;
          if (ci >= next.length) return next.length - 1;
          if (ci > idx) return ci - 1;
          return ci;
        });
        return next;
      });
    },
    [],
  );

  const renameSession = useCallback((idx: number, label: string) => {
    setSessions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, label } : s)),
    );
  }, []);

  const visiblePaneSessionIds = useMemo(() => {
    const validIds = new Set(sessions.map((session) => session.id));
    return uniqueSessionIds(paneSessionIds.filter((id) => validIds.has(id)));
  }, [paneSessionIds, sessions]);

  const visiblePaneSessions = useMemo(
    () =>
      visiblePaneSessionIds
        .map((id) => sessions.find((session) => session.id === id))
        .filter((session): session is TerminalSession => Boolean(session)),
    [sessions, visiblePaneSessionIds],
  );

  const hiddenPaneSessions = useMemo(() => {
    const visibleIds = new Set(visiblePaneSessionIds);
    return sessions.filter((session) => !visibleIds.has(session.id));
  }, [sessions, visiblePaneSessionIds]);

  const focusSessionById = useCallback((sessionId: string) => {
    const idx = sessions.findIndex((session) => session.id === sessionId);
    if (idx >= 0) setCurrentIdx(idx);
  }, [sessions]);

  const selectSession = useCallback((idx: number) => {
    const session = sessions[idx];
    if (!session) return;
    setCurrentIdx(idx);
    setPaneSessionIds((prev) => {
      if (prev.includes(session.id)) return prev;
      if (prev.length === 0) return [session.id];
      return prev.map((paneId, paneIdx) => (paneIdx === 0 ? session.id : paneId));
    });
  }, [sessions]);

  const splitSessionIntoPane = useCallback(
    (sessionId: string, targetSessionId: string, side: SplitSide) => {
      if (!sessions.some((session) => session.id === sessionId)) return;
      if (sessionId === targetSessionId) return;
      setSplitDirection(directionForSplitSide(side));
      setPaneSessionIds((prev) =>
        insertPaneSession(prev.length ? prev : [targetSessionId], sessionId, targetSessionId, side),
      );
      focusSessionById(sessionId);
    },
    [focusSessionById, sessions],
  );

  const onSplitTerminal = useCallback(
    (direction: SplitDirection) => {
      const side: SplitSide = direction === "horizontal" ? "right" : "bottom";
      const activeSessionId = sessions[currentIdx]?.id;
      const nextId = addSession(undefined, "split");
      setSplitDirection(direction);
      setPaneSessionIds((prev) =>
        insertPaneSession(
          prev.filter((paneId) => paneId !== nextId),
          nextId,
          activeSessionId ?? prev[prev.length - 1],
          side,
        ),
      );
    },
    [addSession, currentIdx, sessions],
  );

  useEffect(() => {
    if (view !== "terminal" || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      // Ctrl-chords typed inside the terminal belong to the SHELL, not to
      // tab management: Ctrl+W is readline delete-word and Ctrl+N is
      // next-history. Hijacking them closed/spawned tabs mid-keystroke,
      // which read as the terminal randomly "losing the ability to type".
      // ⌘-chords still manage tabs (macOS terminals reserve ⌘, never Ctrl).
      if (e.ctrlKey && !e.metaKey && target?.closest?.(".xterm")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addSession();
      } else if (e.key === "w" || e.key === "W") {
        if (sessions.length === 0) return;
        e.preventDefault();
        removeSession(currentIdx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, active, addSession, removeSession, currentIdx, sessions.length]);

  const openFilePreview = useCallback(async (path: string) => {
    setPreviewPath(path);
    setPreviewLoading(true);
    setPreview(null);
    setPreviewRaw(false);
    try {
      const res = await fetch(
        `/api/project-file?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        kind?: "text" | "image";
        content?: string;
        dataUrl?: string;
        mimeType?: string;
        size?: number;
        error?: string;
      };
      if (json.ok && json.kind === "image" && typeof json.dataUrl === "string" && typeof json.mimeType === "string") {
        setPreview({ kind: "image", dataUrl: json.dataUrl, mimeType: json.mimeType, size: json.size });
      } else if (json.ok && typeof json.content === "string") {
        setPreview({ kind: "text", content: json.content, size: json.size });
      } else {
        setPreview({ kind: "text", content: `// Error: ${json.error ?? "unknown"}` });
      }
    } catch (err) {
      setPreview({ kind: "text", content: `// Fetch failed: ${String(err)}` });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const copyPreview = useCallback(() => {
    if (!preview || preview.kind !== "text") return;
    void navigator.clipboard.writeText(preview.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [preview]);

  const selectProject = useCallback((project: ComuxProject) => {
    setSelectedProjectRoot(project.root);
    setPreviewPath(null);
    setPreview(null);
  }, []);

  const recentProjectSessions = useMemo(() => {
    if (!selectedProject) return [];
    return daemonSessions
      .filter((session) => session.project_root === selectedProject.root)
      .sort((a, b) =>
        (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
      )
      .slice(0, 6);
  }, [daemonSessions, selectedProject]);

  const previewIsMarkdown = preview?.kind === "text" && isMarkdownPath(previewPath);
  const previewLineCount = preview?.kind === "text" ? preview.content.split("\n").length : 0;
  const renderAsMarkdown = previewIsMarkdown && !previewRaw;

  return (
    <div className="flex h-full flex-col">
      {view === "terminal" ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Session tab strip */}
          <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 py-1 text-[11px]">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {sessions.map((s, i) => (
                <div
                  key={s.id}
                  draggable
                  className={`group flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                    i === currentIdx
                      ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                  onClick={() => selectSession(i)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(TERMINAL_SESSION_DRAG_TYPE, s.id);
                  }}
                  title="Drag onto a pane edge to split"
                >
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) =>
                      renameSession(i, e.currentTarget.textContent ?? s.label)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLElement).blur();
                      }
                    }}
                    className="max-w-[120px] truncate outline-none"
                  >
                    {s.label}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(i);
                    }}
                    className="hidden items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] group-hover:inline-flex"
                    aria-label={`Close ${s.label}`}
                  >
                    <Icon name="ph:x-bold" width={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex items-center gap-0.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5">
                <button
                  type="button"
                  onClick={() => onSplitTerminal("horizontal")}
                  disabled={sessions.length === 0}
                  className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-40"
                  title="Split right"
                >
                  <Icon name="ph:columns" width={12} aria-hidden />
                  <span>Split right</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSplitTerminal("vertical")}
                  disabled={sessions.length === 0}
                  className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-40"
                  title="Split down"
                >
                  <Icon name="ph:rows" width={12} aria-hidden />
                  <span>Split down</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => addSession()}
                aria-label="New terminal"
                title="New terminal (⌘N)"
                className="inline-grid h-[22px] w-[22px] place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
              >
                <Icon name="ph:plus" width={12} aria-hidden />
              </button>
            </div>
          </div>

          {/* Terminal area */}
          <div className="flex-1 min-h-0 relative">
            {sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="flex flex-col items-center gap-1 text-center">
                  <p className="text-sm text-[var(--text-secondary)]">No terminal sessions</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Start one to run commands inside the cave.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addSession()}
                    className="rounded border border-[var(--border-hairline)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  >
                    + New terminal
                  </button>
                  <kbd className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    ⌘N
                  </kbd>
                </div>
              </div>
            ) : (
              <>
                <Group
                  className="h-full min-h-0 w-full"
                  orientation={splitDirection}
                >
                  {visiblePaneSessions.map((s, paneIdx) => {
                    const sessionIdx = sessions.findIndex((session) => session.id === s.id);
                    return (
                      <Fragment key={s.id}>
                        <Panel
                          id={`terminal-pane-${s.id}`}
                          minSize={18}
                          defaultSize={100 / Math.max(visiblePaneSessions.length, 1)}
                          className="h-full min-h-0 min-w-0 overflow-hidden"
                        >
                          <div
                            className="comux-terminal-pane"
                            data-terminal-pane-id={s.id}
                            data-active={sessionIdx === currentIdx ? "true" : undefined}
                            onClick={() => focusSessionById(s.id)}
                          >
                            <div className="comux-terminal-pane-bar">
                              <Icon name="ph:terminal-window" width={12} aria-hidden />
                              <span className="min-w-0 flex-1 truncate">{s.label}</span>
                              {visiblePaneSessions.length > 1 ? (
                                <button
                                  type="button"
                                  className="comux-terminal-pane-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPaneSessionIds((prev) => prev.filter((id) => id !== s.id));
                                  }}
                                  aria-label={`Remove ${s.label} from split`}
                                  title="Remove split"
                                >
                                  <Icon name="ph:x-bold" width={10} aria-hidden />
                                </button>
                              ) : null}
                            </div>
                            <div className="comux-terminal-pane-body">
                              <TerminalDropZone side="left" onSplit={(dragged, side) => splitSessionIntoPane(dragged, s.id, side)} />
                              <TerminalDropZone side="right" onSplit={(dragged, side) => splitSessionIntoPane(dragged, s.id, side)} />
                              <TerminalDropZone side="top" onSplit={(dragged, side) => splitSessionIntoPane(dragged, s.id, side)} />
                              <TerminalDropZone side="bottom" onSplit={(dragged, side) => splitSessionIntoPane(dragged, s.id, side)} />
                              <BottomTerminal
                                threadId={`cave.comux.${s.id}`}
                                active={active && sessionIdx === currentIdx}
                                projectRoot={s.projectRoot ?? selectedProjectRoot ?? daemonProjectRoot}
                              />
                            </div>
                          </div>
                        </Panel>
                        {paneIdx < visiblePaneSessions.length - 1 ? (
                          <Separator
                            className="comux-terminal-resize shrink-0"
                            data-terminal-resize-handle={paneIdx}
                            data-orientation={splitDirection === "horizontal" ? "col" : "row"}
                          >
                            <SeparatorHandle orientation={splitDirection === "horizontal" ? "col" : "row"} />
                          </Separator>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Group>
                <div className="comux-terminal-keepalive" aria-hidden="true">
                  {hiddenPaneSessions.map((s) => (
                    <BottomTerminal
                      key={s.id}
                      threadId={`cave.comux.${s.id}`}
                      active={false}
                      projectRoot={s.projectRoot ?? selectedProjectRoot ?? daemonProjectRoot}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <footer className="shrink-0 border-t border-[var(--border-hairline)] px-3 py-1.5 text-center text-[10px] text-[var(--text-muted)]">
            ⌘N new · ⌘W close · drag tabs onto pane edges to split · drag dividers to resize
          </footer>
        </div>
      ) : (
        /* Project tab */
        <div className="flex flex-1 min-h-0">
          {/* Project list */}
          <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--border-hairline)] py-2 text-[12px]">
            <div className="mb-1 flex items-center gap-1.5 px-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Projects</span>
              <span className="ml-auto rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[9px] text-[var(--text-muted)]">
                {projects.length}
              </span>
            </div>
            <div className="space-y-px px-1">
              {projects.map((project) => {
                const isActive = selectedProject?.root === project.root;
                const meta: string[] = [];
                if (project.sessionCount > 0) {
                  meta.push(`${project.sessionCount} ${project.sessionCount === 1 ? "chat" : "chats"}`);
                }
                if (project.updatedAt) meta.push(shortProjectTime(project.updatedAt));
                return (
                  <button
                    key={project.root}
                    type="button"
                    onClick={() => selectProject(project)}
                    title={project.root}
                    className={`comux-project-row group flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left text-[12px] transition-colors ${
                      isActive
                        ? "comux-project-row--active text-[var(--text-primary)]"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                    }`}
                  >
                    <Icon
                      name={project.runningCount > 0 ? "ph:folder-open" : "ph:folder"}
                      width={14}
                      className={`shrink-0 ${isActive ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium leading-tight">{project.name}</span>
                      {meta.length > 0 && (
                        <span className="truncate text-[10px] leading-tight text-[var(--text-muted)]">
                          {meta.join(" · ")}
                        </span>
                      )}
                    </span>
                    {project.runningCount > 0 && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]"
                        title={`${project.runningCount} running`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Project detail */}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col">
            {selectedProject ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2">
                <div className="flex min-h-0 min-w-0 flex-col border-b border-[var(--border-hairline)] xl:border-b-0 xl:border-r">
                  <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon name="ph:folder-open" width={15} className="shrink-0 text-[var(--text-muted)]" />
                          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {selectedProject.name}
                          </h2>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                          {selectedProject.root}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => addSession(selectedProject.root)}
                          className="flex items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                        >
                          <Icon name="ph:plus" width={12} />
                          Terminal
                        </button>
                        <button
                          type="button"
                          onClick={() => onNewChat(selectedProject.root)}
                          className="flex items-center gap-1 rounded-md bg-[var(--accent-presence)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-85"
                        >
                          <Icon name="ph:chat-circle-dots" width={12} />
                          New chat
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {/* Recent sessions — collapsible */}
                    <div className="mb-2">
                      <button
                        type="button"
                        onClick={() => setSessionsCollapsed((v) => !v)}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-[3px] text-left transition-colors hover:bg-[var(--bg-raised)]"
                      >
                        <svg
                          width="7" height="7" viewBox="0 0 8 8"
                          className="shrink-0 text-[var(--text-muted)] transition-transform duration-150"
                          style={{ transform: sessionsCollapsed ? "rotate(0deg)" : "rotate(90deg)" }}
                        >
                          <polygon points="1,1 7,4 1,7" fill="currentColor" />
                        </svg>
                        <Icon name="ph:chats-circle" width={11} className="shrink-0 text-[var(--text-muted)]" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Sessions</span>
                        {recentProjectSessions.length > 0 && (
                          <span className="ml-auto rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[9px] text-[var(--text-muted)]">
                            {recentProjectSessions.length}
                          </span>
                        )}
                      </button>
                      {!sessionsCollapsed && (
                        recentProjectSessions.length === 0 ? (
                          <p className="py-1 pl-6 text-[11px] text-[var(--text-muted)]">No chats yet.</p>
                        ) : (
                          <div className="space-y-px">
                            {recentProjectSessions.map((session) => (
                              <button
                                key={session.id}
                                type="button"
                                onClick={() => onOpenSession(session.id, session.familiarId)}
                                className="flex w-full items-center gap-2 rounded py-[4px] pl-6 pr-2 text-left text-[11px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
                              >
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  session.status === "running" ? "bg-[var(--color-success)]"
                                  : session.status === "failed" ? "bg-red-400"
                                  : "bg-[var(--border-strong)]"
                                }`} />
                                <span className="min-w-0 flex-1 truncate">
                                  {session.title || "(untitled chat)"}
                                </span>
                                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                                  {shortProjectTime(session.updated_at)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </div>

                    {/* Files — native tree */}
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 px-1 py-[3px]">
                        <Icon name="ph:list-bullets" width={11} className="shrink-0 text-[var(--text-muted)]" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Files</span>
                        <button
                          type="button"
                          onClick={() => treeRef.current?.refresh()}
                          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
                          title="Refresh files"
                          aria-label="Refresh files"
                        >
                          <Icon name="ph:arrow-clockwise" width={11} />
                        </button>
                      </div>
                      <ProjectTree
                        ref={treeRef}
                        root={selectedProject.root}
                        selectedPath={previewPath}
                        onFileClick={openFilePreview}
                      />
                    </div>
                  </div>
                </div>

                <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">
                  {previewPath ? (
                    <>
                      {/* Preview header */}
                      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
                        <Icon
                          name={preview?.kind === "image" ? "ph:file-image" : previewIsMarkdown ? "ph:file-text" : "ph:file-code"}
                          width={12}
                          className="shrink-0 text-[var(--text-muted)]"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                          {previewPath.startsWith(selectedProject.root)
                            ? previewPath.slice(selectedProject.root.length).replace(/^\//, "")
                            : previewPath}
                        </span>
                        {preview?.kind === "text" && (
                          <span className="hidden shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--text-muted)] sm:flex">
                            <span>{previewLineCount.toLocaleString()} {previewLineCount === 1 ? "line" : "lines"}</span>
                            {formatBytes(preview.size) && <span>· {formatBytes(preview.size)}</span>}
                          </span>
                        )}
                        {previewIsMarkdown && (
                          <div className="flex shrink-0 items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => setPreviewRaw(false)}
                              className={`rounded-[4px] px-1.5 py-0.5 transition-colors ${!previewRaw ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                            >
                              Rendered
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewRaw(true)}
                              className={`rounded-[4px] px-1.5 py-0.5 transition-colors ${previewRaw ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                            >
                              Raw
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={copyPreview}
                          disabled={!preview || preview.kind !== "text"}
                          className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:opacity-30"
                        >
                          <Icon name="ph:copy" width={11} />
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      {/* Preview content */}
                      <div className="comux-file-preview min-h-0 flex-1 overflow-auto p-3">
                        {previewLoading ? (
                          <div className="flex items-center gap-2 py-4 text-[11px] text-[var(--text-muted)]">
                            <Icon name="ph:arrow-clockwise" width={12} className="animate-spin" />
                            Loading…
                          </div>
                        ) : (
                          preview?.kind === "image" ? (
                            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] p-4">
                              <img
                                src={preview.dataUrl}
                                alt={`Preview of ${previewPath.split("/").pop() ?? "image"}`}
                                className="max-h-full max-w-full rounded border border-[var(--border-hairline)] object-contain"
                              />
                              <div className="font-mono text-[10px] text-[var(--text-muted)]">
                                {preview.mimeType}
                                {typeof preview.size === "number" ? ` · ${preview.size.toLocaleString()} bytes` : ""}
                              </div>
                            </div>
                          ) : renderAsMarkdown ? (
                            <MarkdownBlock
                              text={preview?.content ?? ""}
                              className="comux-md max-w-[72ch]"
                            />
                          ) : (
                            <SyntaxBlock
                              text={preview?.content ?? ""}
                              lang={previewPath.split(".").pop()}
                              className="leading-relaxed"
                            />
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <Icon name="ph:file" width={28} className="opacity-30" />
                      <p>Select a file to preview</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
                No projects found yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
