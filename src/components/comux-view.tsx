"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomTerminal } from "@/components/bottom-terminal";
import { Icon } from "@/lib/icon";
import { ProjectTree, type ProjectTreeHandle } from "@/components/project-tree";
import { SyntaxBlock } from "@/components/message-bubble";
import {
  deriveComuxProjects,
  projectName,
  type ComuxProject,
} from "@/lib/comux-projects";
import type { SessionRow } from "@/lib/types";

type ComuxTab = "comux" | "project";

type TerminalSession = {
  id: string;
  label: string;
  projectRoot?: string;
};

type Props = {
  sessions: SessionRow[];
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onNewChat: (projectRoot: string) => void;
};

const STORAGE_TAB = "cave:comux:tab";
const STORAGE_SESSIONS = "cave:comux:sessions";

function readTab(): ComuxTab {
  if (typeof window === "undefined") return "comux";
  const v = window.localStorage.getItem(STORAGE_TAB);
  return v === "project" ? "project" : "comux";
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

export function ComuxView({ sessions: daemonSessions, onOpenSession, onNewChat }: Props) {
  const [tab, setTab] = useState<ComuxTab>(readTab);
  const [sessions, setSessions] = useState<TerminalSession[]>(readSessions);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Project tab state
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Persist tab choice
  useEffect(() => {
    window.localStorage.setItem(STORAGE_TAB, tab);
  }, [tab]);

  // Persist sessions
  useEffect(() => {
    window.localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(sessions));
  }, [sessions]);

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

  const addSession = useCallback((rootOverride?: string) => {
    const id = uid();
    const root = rootOverride ?? selectedProjectRoot ?? daemonProjectRoot;
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
    setTab("comux");
  }, [daemonProjectRoot, selectedProjectRoot]);

  const removeSession = useCallback(
    (idx: number) => {
      setSessions((prev) => {
        const next = prev.filter((_, i) => i !== idx);
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

  const openFilePreview = useCallback(async (path: string) => {
    setPreviewPath(path);
    setPreviewLoading(true);
    setPreviewContent(null);
    try {
      const res = await fetch(
        `/api/project-file?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        content?: string;
        error?: string;
      };
      if (json.ok && typeof json.content === "string") {
        setPreviewContent(json.content);
      } else {
        setPreviewContent(`// Error: ${json.error ?? "unknown"}`);
      }
    } catch (err) {
      setPreviewContent(`// Fetch failed: ${String(err)}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const copyPreview = useCallback(() => {
    if (!previewContent) return;
    void navigator.clipboard.writeText(previewContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [previewContent]);

  const selectProject = useCallback((project: ComuxProject) => {
    setSelectedProjectRoot(project.root);
    setPreviewPath(null);
    setPreviewContent(null);
    setTab("project");
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

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] px-3 py-2">
        <button
          type="button"
          onClick={() => setTab("comux")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
            tab === "comux"
              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Icon name="ph:terminal-window" width={13} />
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setTab("project")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
            tab === "project"
              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Icon name="ph:folder-open" width={13} />
          Project
        </button>
      </div>

      {/* Tab content */}
      {tab === "comux" ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Session tab strip */}
          <div className="flex items-center gap-0.5 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 py-1 text-[11px]">
            {sessions.map((s, i) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded px-2 py-0.5 cursor-pointer transition-colors ${
                  i === currentIdx
                    ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                onClick={() => setCurrentIdx(i)}
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
                  className="outline-none max-w-[120px] truncate"
                >
                  {s.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(i);
                  }}
                  className="hidden group-hover:inline-flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:x-bold" width={10} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addSession()}
              className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
            >
              +
            </button>
          </div>

          {/* Terminal area */}
          <div className="flex-1 min-h-0 relative">
            {sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <p>No terminal sessions.</p>
                <button
                  type="button"
                  onClick={() => addSession()}
                  className="rounded border border-[var(--border-hairline)] px-3 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  + New terminal
                </button>
              </div>
            ) : (
              sessions.map((s, i) => (
                <div
                  key={s.id}
                  className="h-full w-full"
                  style={{
                    position: "absolute",
                    inset: 0,
                    visibility: i === currentIdx ? "visible" : "hidden",
                    pointerEvents: i === currentIdx ? "auto" : "none",
                  }}
                >
                  <BottomTerminal
                    threadId={`cave.comux.${s.id}`}
                    active={i === currentIdx}
                    projectRoot={s.projectRoot ?? selectedProjectRoot ?? daemonProjectRoot}
                  />
                </div>
              ))
            )}
          </div>
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
            <div className="space-y-px">
              {projects.map((project) => (
                <button
                  key={project.root}
                  type="button"
                  onClick={() => selectProject(project)}
                  title={project.root}
                  className={`flex w-full items-center gap-2 px-3 py-[5px] text-left transition-colors ${
                    selectedProject?.root === project.root
                      ? "bg-[var(--accent-presence)] text-white"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                  }`}
                >
                  <Icon
                    name={project.runningCount > 0 ? "ph:folder-open" : "ph:folder"}
                    width={13}
                    className={`shrink-0 ${
                      selectedProject?.root === project.root
                        ? "text-white/70"
                        : "text-[var(--text-muted)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {project.runningCount > 0 && (
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      selectedProject?.root === project.root ? "bg-white/60" : "bg-emerald-400"
                    }`} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Project detail */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedProject ? (
              <>
                <div className="border-b border-[var(--border-hairline)] px-4 py-3">
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

                <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(220px,32%)_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto border-b border-[var(--border-hairline)] p-3 xl:border-b-0 xl:border-r">
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
                                  session.status === "running" ? "bg-emerald-400"
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
                      <div className="mb-1 flex items-center justify-end pr-0.5">
                        <button
                          type="button"
                          onClick={() => treeRef.current?.refresh()}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
                          title="Refresh"
                        >
                          <Icon name="ph:arrow-clockwise" width={10} />
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

                  <div className="min-w-0 flex flex-col overflow-hidden">
                    {previewPath ? (
                      <>
                        {/* Preview header */}
                        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
                          <Icon name="ph:file-code" width={12} className="shrink-0 text-[var(--text-muted)]" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                            {previewPath.startsWith(selectedProject.root)
                              ? previewPath.slice(selectedProject.root.length).replace(/^\//, "")
                              : previewPath}
                          </span>
                          <button
                            type="button"
                            onClick={copyPreview}
                            disabled={!previewContent}
                            className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:opacity-30"
                          >
                            <Icon name="ph:copy" width={11} />
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                        {/* Preview content */}
                        <div className="min-h-0 flex-1 overflow-auto p-3">
                          {previewLoading ? (
                            <div className="flex items-center gap-2 py-4 text-[11px] text-[var(--text-muted)]">
                              <Icon name="ph:arrow-clockwise" width={12} className="animate-spin" />
                              Loading…
                            </div>
                          ) : (
                            <SyntaxBlock
                              text={previewContent ?? ""}
                              lang={previewPath.split(".").pop()}
                              className="leading-relaxed"
                            />
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
              </>
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
