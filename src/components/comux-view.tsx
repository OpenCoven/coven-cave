"use client";

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BottomTerminal } from "@/components/bottom-terminal";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { ProjectTree, type ProjectTreeHandle } from "@/components/project-tree";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";
import { SessionChangesInner } from "@/components/session-changes-panel";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { CodeEditor } from "@/components/code-editor";
import { resolveLangLabel } from "@/lib/code-lang";
import {
  CODE_PRESET_EVENT,
  CODE_PRESET_RIGHT_VIEW,
  CODE_PROJECT_LIST_EVENT,
  readProjectListCollapsed,
  writeProjectListCollapsed,
  type CodePreset,
} from "@/lib/code-layout-preset";
import type { SearchResult } from "@/lib/project-search";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  deriveComuxProjects,
  projectName,
  type ComuxProject,
} from "@/lib/comux-projects";
import {
  addTerminalSession,
  closeTerminalSession,
  createTerminalLayout,
  focusTerminalSession,
  moveTerminalPane,
  normalizeTerminalLayout,
  removeTerminalPaneView,
  renameTerminalSession,
  terminalLayoutVisibleSessionIds,
  type TerminalLayoutNode,
  type TerminalLayoutState,
  type TerminalSession,
  type TerminalSplitDirection,
  type TerminalSplitSide,
} from "@/lib/terminal-layout";
import type { SessionRow } from "@/lib/types";

type ComuxViewMode = "terminal" | "projects";

type SessionPlacement = "replace" | "split";

type Props = {
  view: ComuxViewMode;
  sessions: SessionRow[];
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onNewChat: (projectRoot: string) => void;
  active?: boolean;
  /** Suffix that isolates this instance's persisted terminal layout/sessions
   *  from other ComuxView instances (e.g. the Code workspace keeps its own
   *  terminals separate from the standalone Terminal surface). */
  storageNamespace?: string;
};

type ProjectFilePreview =
  | { kind: "text"; content: string; size?: number }
  | { kind: "image"; dataUrl: string; mimeType: string; size?: number }
  | { kind: "error"; message: string };

const STORAGE_SESSIONS = "cave:comux:sessions";
const STORAGE_LAYOUT = "cave:comux:terminal-layout:v1";
const TERMINAL_SESSION_DRAG_TYPE = "application/x-cave-terminal-session";

function TerminalDropZone({
  side,
  onSplit,
}: {
  side: TerminalSplitSide;
  onSplit: (sessionId: string, side: TerminalSplitSide) => void;
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

function readLegacySessions(storageKey: string): TerminalSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
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

function isLayoutNode(value: unknown): value is TerminalLayoutNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind === "leaf") return typeof node.sessionId === "string";
  if (node.kind !== "horizontal" && node.kind !== "vertical") return false;
  return Array.isArray(node.children) && node.children.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const child = entry as Record<string, unknown>;
    return typeof child.size === "number" && isLayoutNode(child.node);
  });
}

function readTerminalLayout(layoutKey: string, sessionsKey: string): TerminalLayoutState {
  if (typeof window === "undefined") return createTerminalLayout();
  try {
    const raw = window.localStorage.getItem(layoutKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TerminalLayoutState>;
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.sessions) &&
        (parsed.root === null || isLayoutNode(parsed.root))
      ) {
        const layout: TerminalLayoutState = {
          version: 1,
          sessions: parsed.sessions.filter(
            (session): session is TerminalSession =>
              typeof session === "object" &&
              session !== null &&
              typeof (session as Record<string, unknown>).id === "string" &&
              typeof (session as Record<string, unknown>).label === "string",
          ).map((session) => ({
            id: session.id,
            label: session.label,
            projectRoot:
              typeof session.projectRoot === "string"
                ? session.projectRoot
                : undefined,
          })),
          activeSessionId:
            typeof parsed.activeSessionId === "string"
              ? parsed.activeSessionId
              : null,
          root: parsed.root ?? null,
        };
        return normalizeTerminalLayout(layout);
      }
    }
  } catch {
    // Fall back to the legacy flat session list below.
  }
  const legacy = readLegacySessions(sessionsKey);
  return createTerminalLayout(legacy, legacy[0]?.id ?? null);
}

type TerminalLayoutAction =
  | {
      type: "add";
      session: TerminalSession;
      placement?: SessionPlacement;
      targetSessionId?: string | null;
      side?: TerminalSplitSide;
    }
  | { type: "close"; sessionId: string }
  | { type: "focus"; sessionId: string }
  | { type: "move"; sourceSessionId: string; targetSessionId: string; side: TerminalSplitSide }
  | { type: "remove-view"; sessionId: string }
  | { type: "rename"; sessionId: string; label: string };

function terminalLayoutReducer(
  state: TerminalLayoutState,
  action: TerminalLayoutAction,
): TerminalLayoutState {
  switch (action.type) {
    case "add":
      return addTerminalSession(state, action.session, {
        placement: action.placement,
        targetSessionId: action.targetSessionId ?? undefined,
        side: action.side,
      });
    case "close":
      return closeTerminalSession(state, action.sessionId);
    case "focus":
      return focusTerminalSession(state, action.sessionId);
    case "move":
      return moveTerminalPane(state, action);
    case "remove-view":
      return removeTerminalPaneView(state, action.sessionId);
    case "rename":
      return renameTerminalSession(state, action.sessionId, action.label);
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

export function ComuxView({ view, sessions: daemonSessions, onOpenSession, onNewChat, active = true, storageNamespace = "" }: Props) {
  const layoutKey = STORAGE_LAYOUT + storageNamespace;
  const sessionsKey = STORAGE_SESSIONS + storageNamespace;
  const [terminalLayout, dispatchTerminalLayout] = useReducer(
    terminalLayoutReducer,
    undefined,
    () => readTerminalLayout(layoutKey, sessionsKey),
  );
  const sessions = terminalLayout.sessions;
  const activeSessionId = terminalLayout.activeSessionId;
  const currentIdx = Math.max(
    0,
    sessions.findIndex((session) => session.id === activeSessionId),
  );

  // Project tab state
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewRaw, setPreviewRaw] = useState(false);
  // 1-based line to scroll the preview to (set when opened from a search match,
  // cleared when opened from the file tree).
  const [previewLine, setPreviewLine] = useState<number | undefined>(undefined);
  // Editable preview: edit mode swaps the read-only render for a textarea and
  // POSTs back to /api/project-file on save.
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Brief "Saved" confirmation after a successful write (auto-clears).
  const [justSaved, setJustSaved] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  // Projects list (the 200px column) visibility, driven by the Code workspace
  // toolbar's Projects toggle and its layout presets over window events. Lives
  // here because comux owns the column; code-view only mirrors the boolean.
  const [projectListCollapsed, setProjectListCollapsed] = useState(false);
  const [projectDetailCollapsed, setProjectDetailCollapsed] = useState(false);
  const [filePreviewCollapsed, setFilePreviewCollapsed] = useState(false);
  // Right pane view: the file preview, or the project's git changes/diff review.
  const [rightView, setRightView] = useState<"files" | "changes">("files");
  // Diff-first review: auto-switch to Changes the first time an agent run
  // produces edits — but never fight an explicit user choice. pinnedRightView
  // flips once the user clicks a toggle or opens a file; prevChangeCount tracks
  // the 0→>0 edit transition so we surface the diff exactly once per project.
  const pinnedRightViewRef = useRef(false);
  // Jump-to-diff target from a transcript edit tool (cave:open-file-diff). The
  // nonce re-triggers the focus even when the same path is clicked again.
  const [focusDiff, setFocusDiff] = useState<{ path: string; nonce: number } | null>(null);
  const prevChangeCountRef = useRef(0);
  // Project-wide code search (CODE-SEARCH-01).
  const [searchInput, setSearchInput] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchGlob, setSearchGlob] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const treeRef = useRef<ProjectTreeHandle | null>(null);
  const wasActiveTerminalRef = useRef(false);

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

  // Persist the full pane tree. Keep the legacy flat key in sync so older
  // versions can still recover terminal tabs if a user rolls back.
  useEffect(() => {
    window.localStorage.setItem(layoutKey, JSON.stringify(terminalLayout));
    window.localStorage.setItem(sessionsKey, JSON.stringify(sessions));
  }, [terminalLayout, sessions, layoutKey, sessionsKey]);

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
    const targetSessionId =
      terminalLayout.activeSessionId ??
      terminalLayoutVisibleSessionIds(terminalLayout)[0] ??
      null;
    dispatchTerminalLayout({
      type: "add",
      session: {
        id,
        label: root ? `${projectName(root)} ${sessions.length + 1}` : `Terminal ${sessions.length + 1}`,
        projectRoot: root,
      },
      placement,
      targetSessionId,
      side: placement === "split" ? "right" : undefined,
    });
    return id;
  }, [daemonProjectRoot, selectedProjectRoot, sessions.length, terminalLayout]);

  // Cross-surface launch: other surfaces (e.g. the Projects page) open a
  // terminal in a specific project by dispatching `cave:terminal-open` with the
  // project root. Only the canonical terminal instance handles it so a single
  // session is created, and it spawns in that project's cwd via addSession.
  useEffect(() => {
    // Gate on `active` so that when several ComuxView instances are mounted
    // (e.g. the hidden Terminal surface plus the visible Code workspace), only
    // the active one opens a session — otherwise a single event spawns two.
    if (view !== "terminal" || !active) return;
    const onTerminalOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ projectRoot?: string }>).detail;
      addSession(detail?.projectRoot);
    };
    window.addEventListener("cave:terminal-open", onTerminalOpen as EventListener);
    return () => window.removeEventListener("cave:terminal-open", onTerminalOpen as EventListener);
  }, [view, active, addSession]);

  useEffect(() => {
    const activeTerminal = view === "terminal" && active;
    if (!activeTerminal) {
      wasActiveTerminalRef.current = false;
      return;
    }
    if (wasActiveTerminalRef.current) return;
    wasActiveTerminalRef.current = true;
    if (sessions.length > 0) return;
    addSession();
  }, [active, addSession, sessions.length, view]);

  const removeSession = useCallback(
    (idx: number) => {
      const removedId = sessions[idx]?.id;
      if (!removedId) return;
      dispatchTerminalLayout({ type: "close", sessionId: removedId });
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
    },
    [sessions],
  );

  const renameSession = useCallback((idx: number, label: string) => {
    const session = sessions[idx];
    if (!session) return;
    // Ignore blank/whitespace-only names so a cleared tab keeps its label
    // instead of becoming an empty tab.
    const trimmed = label.trim();
    if (!trimmed) return;
    dispatchTerminalLayout({ type: "rename", sessionId: session.id, label: trimmed });
  }, [sessions]);

  const visiblePaneSessionIds = useMemo(
    () => terminalLayoutVisibleSessionIds(terminalLayout),
    [terminalLayout],
  );

  const hiddenPaneSessions = useMemo(() => {
    const visibleIds = new Set(visiblePaneSessionIds);
    return sessions.filter((session) => !visibleIds.has(session.id));
  }, [sessions, visiblePaneSessionIds]);

  const focusSessionById = useCallback((sessionId: string) => {
    dispatchTerminalLayout({ type: "focus", sessionId });
  }, []);

  const selectSession = useCallback((idx: number) => {
    const session = sessions[idx];
    if (!session) return;
    dispatchTerminalLayout({ type: "focus", sessionId: session.id });
  }, [sessions]);

  const splitSessionIntoPane = useCallback(
    (sessionId: string, targetSessionId: string, side: TerminalSplitSide) => {
      if (!sessions.some((session) => session.id === sessionId)) return;
      if (sessionId === targetSessionId) return;
      dispatchTerminalLayout({
        type: "move",
        sourceSessionId: sessionId,
        targetSessionId,
        side,
      });
    },
    [sessions],
  );

  const onSplitTerminal = useCallback(
    (direction: TerminalSplitDirection) => {
      const side: TerminalSplitSide = direction === "horizontal" ? "right" : "bottom";
      const id = uid();
      const root = selectedProjectRoot ?? daemonProjectRoot;
      dispatchTerminalLayout({
        type: "add",
        session: {
          id,
          label: root ? `${projectName(root)} ${sessions.length + 1}` : `Terminal ${sessions.length + 1}`,
          projectRoot: root,
        },
        placement: "split",
        targetSessionId: terminalLayout.activeSessionId ?? visiblePaneSessionIds[0] ?? null,
        side,
      });
    },
    [daemonProjectRoot, selectedProjectRoot, sessions.length, terminalLayout.activeSessionId, visiblePaneSessionIds],
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

  const openFilePreview = useCallback(async (path: string, line?: number) => {
    setPreviewPath(path);
    setPreviewLine(line);
    setFilePreviewCollapsed(false);
    setPreviewLoading(true);
    setPreview(null);
    setPreviewError(null);
    setPreviewRaw(false);
    // Leave any prior edit session — opening a new file discards unsaved edits.
    setEditing(false);
    setSaveError(null);
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
        setPreview({ kind: "error", message: json.error ?? "Could not load this file." });
      }
    } catch (err) {
      setPreview({ kind: "error", message: `Could not load this file. ${String(err)}` });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Click-to-open from chat: a file tool's target (absolute path) or a prose
  // reference (relative, e.g. `src/foo.ts:42`) dispatches `cave:open-project-file`;
  // the active comux opens it in the Files preview. Relative paths resolve
  // against the selected project root. Gated on `active` so only the visible
  // instance reacts.
  const selectedRoot = selectedProject?.root;
  useEffect(() => {
    if (!active) return;
    const onOpenFile = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail;
      if (!detail?.path) return;
      const path = detail.path.startsWith("/")
        ? detail.path
        : selectedRoot
          ? `${selectedRoot.replace(/\/$/, "")}/${detail.path.replace(/^\.?\//, "")}`
          : detail.path;
      // A user-initiated file open is an explicit view choice — pin it so the
      // diff-first auto-switch doesn't yank them back to Changes.
      pinnedRightViewRef.current = true;
      setRightView("files");
      void openFilePreview(path, typeof detail.line === "number" ? detail.line : undefined);
    };
    // Edit tools jump to their file's diff in the Changes review instead of the
    // file preview. Pin Changes and focus that file (matched repo-relative or
    // by suffix inside SessionChangesInner).
    const onOpenDiff = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (!detail?.path) return;
      pinnedRightViewRef.current = true;
      setRightView("changes");
      setFocusDiff((prev) => ({ path: detail.path!, nonce: (prev?.nonce ?? 0) + 1 }));
    };
    window.addEventListener("cave:open-project-file", onOpenFile as EventListener);
    window.addEventListener("cave:open-file-diff", onOpenDiff as EventListener);
    return () => {
      window.removeEventListener("cave:open-project-file", onOpenFile as EventListener);
      window.removeEventListener("cave:open-file-diff", onOpenDiff as EventListener);
    };
  }, [active, openFilePreview, selectedRoot]);

  // Code workspace toolbar wiring (projects view only): the Projects toggle
  // shows/hides this column, and a layout preset additionally switches the
  // right pane (Review → Changes, Split → Files). Sync the initial collapse
  // state from storage so a reload remembers it.
  useEffect(() => {
    if (view !== "projects") return;
    setProjectListCollapsed(readProjectListCollapsed());
    const onProjectList = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      setProjectListCollapsed(Boolean(detail?.collapsed));
    };
    const onPreset = (event: Event) => {
      const preset = (event as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (!preset) return;
      const nextRight = CODE_PRESET_RIGHT_VIEW[preset];
      if (nextRight) {
        // An explicit preset is a deliberate view choice — pin it so diff-first
        // auto-switch doesn't override.
        pinnedRightViewRef.current = true;
        setRightView(nextRight);
      }
    };
    window.addEventListener(CODE_PROJECT_LIST_EVENT, onProjectList as EventListener);
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    return () => {
      window.removeEventListener(CODE_PROJECT_LIST_EVENT, onProjectList as EventListener);
      window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    };
  }, [view]);

  // Show/hide the projects list from its own header (and the collapsed rail).
  // Persists so a reload remembers; the Code presets also drive this over the
  // event above.
  const setProjectListVisible = useCallback((visible: boolean) => {
    setProjectListCollapsed(!visible);
    writeProjectListCollapsed(!visible);
  }, []);

  const setProjectDetailVisible = useCallback((visible: boolean) => {
    if (!visible && filePreviewCollapsed) setFilePreviewCollapsed(false);
    setProjectDetailCollapsed(!visible);
  }, [filePreviewCollapsed]);

  const setFilePreviewVisible = useCallback((visible: boolean) => {
    if (!visible && projectDetailCollapsed) setProjectDetailCollapsed(false);
    setFilePreviewCollapsed(!visible);
  }, [projectDetailCollapsed]);

  const copyPreview = useCallback(() => {
    if (!preview || preview.kind !== "text") return;
    void copyText(preview.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [preview]);

  // Enter edit mode: seed the textarea with the current source and show raw
  // (markdown previews edit their source, not the rendered HTML).
  const startEditing = useCallback(() => {
    if (!preview || preview.kind !== "text") return;
    setEditValue(preview.content);
    setSaveError(null);
    setJustSaved(false);
    setPreviewRaw(true);
    setEditing(true);
  }, [preview]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!previewPath) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/project-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: previewPath, content: editValue }),
      });
      const json = (await res.json()) as { ok: boolean; size?: number; error?: string };
      if (!res.ok || !json.ok) {
        setSaveError(json.error ?? `save failed (${res.status})`);
        return;
      }
      // Commit the edit into the preview so a cancel/reopen shows saved text.
      setPreview({ kind: "text", content: editValue, size: json.size });
      setEditing(false);
      setJustSaved(true);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [previewPath, editValue]);

  // Auto-clear the "Saved" confirmation a moment after it shows.
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  // A redacted .env (server refuses writes) and error placeholders aren't
  // editable; everything else text is.
  const previewEditable =
    preview?.kind === "text" &&
    !(previewPath ? previewPath.split("/").pop()?.startsWith(".env") : false);

  // Debounced project-wide search. Re-runs when the query, regex toggle, or
  // selected project changes; an empty query clears results without a request.
  const searchRoot = selectedProject?.root;
  useEffect(() => {
    const query = searchInput.trim();
    if (!query || !searchRoot) {
      setSearchResult(null);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ root: searchRoot, q: query });
      if (searchRegex) params.set("regex", "1");
      if (searchCaseSensitive) params.set("case", "sensitive");
      const glob = searchGlob.trim();
      if (glob) params.set("glob", glob);
      fetch(`/api/project/search?${params.toString()}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((json: SearchResult & { ok: boolean; repo?: boolean; error?: string }) => {
          if (cancelled) return;
          if (!json.ok || json.repo === false) {
            setSearchResult(null);
            setSearchError(json.error ?? "search unavailable");
          } else {
            setSearchResult({ files: json.files ?? [], totalMatches: json.totalMatches ?? 0, truncated: !!json.truncated });
            setSearchError(null);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setSearchResult(null);
          setSearchError(String(err));
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, searchRegex, searchCaseSensitive, searchGlob, searchRoot]);

  // Open a search match: search paths are relative to the searched root, so
  // rejoin them to the project root before handing off to the file preview.
  const openSearchMatch = useCallback(
    (relPath: string, line?: number) => {
      if (!searchRoot) return;
      void openFilePreview(`${searchRoot.replace(/\/$/, "")}/${relPath}`, line);
    },
    [searchRoot, openFilePreview],
  );

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

  // Poll the diff while a familiar is actively working this project so the
  // Changes view reflects edits as they land.
  const projectHasRunningSession = recentProjectSessions.some((s) => s.status === "running");

  // Diff-first review: poll a lightweight changes summary while Files is showing
  // and a familiar is working this project, and flip to the Changes/diff view
  // the first time edits appear — unless the user pinned a view. The poll pauses
  // once Changes is shown (SessionChangesInner takes over its own polling).
  const changesSummary = useChangesSummary(
    selectedProject?.root,
    rightView !== "changes" && projectHasRunningSession,
  );
  useEffect(() => {
    // Reset the diff-first decision when switching projects.
    pinnedRightViewRef.current = false;
    prevChangeCountRef.current = 0;
  }, [selectedProject?.root]);
  useEffect(() => {
    const prev = prevChangeCountRef.current;
    prevChangeCountRef.current = changesSummary.count;
    if (
      !pinnedRightViewRef.current &&
      rightView === "files" &&
      prev === 0 &&
      changesSummary.count > 0
    ) {
      setRightView("changes");
    }
  }, [changesSummary.count, rightView]);

  const previewIsMarkdown = preview?.kind === "text" && isMarkdownPath(previewPath);
  const previewLineCount = preview?.kind === "text" ? preview.content.split("\n").length : 0;
  const renderAsMarkdown = previewIsMarkdown && !previewRaw;
  // Language badge for the preview header — resolves the file extension to a
  // human grammar name ("ts" → "TypeScript") matching what the highlighter
  // now actually colorizes.
  const previewExt = previewPath ? previewPath.split(".").pop() : undefined;
  const previewLangLabel = preview?.kind === "text" ? resolveLangLabel(previewExt) : null;
  const visiblePaneCount = visiblePaneSessionIds.length;
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const nodeKey = useCallback((node: TerminalLayoutNode): string => {
    if (node.kind === "leaf") return node.sessionId;
    return `${node.kind}:${node.children.map((entry) => nodeKey(entry.node)).join("|")}`;
  }, []);
  const renderTerminalNode = useCallback(
    (node: TerminalLayoutNode, path = "root"): ReactNode => {
      if (node.kind === "leaf") {
        const s = sessionById.get(node.sessionId);
        if (!s) return null;
        const isActive = s.id === activeSessionId;
        return (
          <div
            className="comux-terminal-pane"
            data-terminal-pane-id={s.id}
            data-active={isActive ? "true" : undefined}
            onClick={() => focusSessionById(s.id)}
          >
            <div
              className="comux-terminal-pane-bar"
              draggable
              data-terminal-pane-handle={s.id}
              title="Drag onto another pane's edge to move this terminal"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(TERMINAL_SESSION_DRAG_TYPE, s.id);
                e.currentTarget
                  .closest(".comux-terminal-pane")
                  ?.setAttribute("data-dragging", "true");
              }}
              onDragEnd={(e) => {
                e.currentTarget
                  .closest(".comux-terminal-pane")
                  ?.removeAttribute("data-dragging");
              }}
            >
              <Icon name="ph:terminal-window" width={12} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {visiblePaneCount > 1 ? (
                <button
                  type="button"
                  draggable={false}
                  className="comux-terminal-pane-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatchTerminalLayout({ type: "remove-view", sessionId: s.id });
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
                active={active && isActive}
                projectRoot={s.projectRoot ?? selectedProjectRoot ?? daemonProjectRoot}
              />
            </div>
          </div>
        );
      }

      return (
        <Group
          className="h-full min-h-0 w-full"
          orientation={node.kind}
        >
          {node.children.map((entry, paneIdx) => {
            const key = nodeKey(entry.node);
            return (
              <Fragment key={`${path}:${key}`}>
                <Panel
                  id={`terminal-pane-${path}-${key}`}
                  minSize={18}
                  defaultSize={entry.size}
                  className="h-full min-h-0 min-w-0 overflow-hidden"
                >
                  {renderTerminalNode(entry.node, `${path}-${paneIdx}`)}
                </Panel>
                {paneIdx < node.children.length - 1 ? (
                  <Separator
                    className="comux-terminal-resize shrink-0"
                    data-terminal-resize-handle={`${path}-${paneIdx}`}
                    data-orientation={node.kind === "horizontal" ? "col" : "row"}
                  >
                    <SeparatorHandle orientation={node.kind === "horizontal" ? "col" : "row"} />
                  </Separator>
                ) : null}
              </Fragment>
            );
          })}
        </Group>
      );
    },
    [
      active,
      activeSessionId,
      daemonProjectRoot,
      focusSessionById,
      nodeKey,
      selectedProjectRoot,
      sessionById,
      splitSessionIntoPane,
      visiblePaneCount,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      {view === "terminal" ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Session tab strip */}
          <div className="comux-terminal-tab-strip flex items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 py-1 text-[11px]">
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
                      } else if (e.key === "Escape") {
                        // Abort the rename: restore the original label before
                        // blur so the onBlur save is a no-op.
                        e.preventDefault();
                        e.currentTarget.textContent = s.label;
                        (e.target as HTMLElement).blur();
                      }
                    }}
                    title="Click to rename · Enter to save · Esc to cancel"
                    className="max-w-[120px] truncate rounded-[3px] px-0.5 outline-none focus:bg-[var(--bg-base)] focus:ring-1 focus:ring-[var(--accent-presence)]"
                  >
                    {s.label}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(i);
                    }}
                    className="comux-terminal-tab-close hidden items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] group-hover:inline-flex"
                    aria-label={`Close ${s.label}`}
                  >
                    <Icon name="ph:x-bold" width={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="comux-terminal-toolbar-actions flex shrink-0 items-center gap-1.5">
              <div className="comux-terminal-split-controls flex items-center gap-0.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5">
                <button
                  type="button"
                  onClick={() => onSplitTerminal("horizontal")}
                  disabled={sessions.length === 0}
                  className="comux-terminal-toolbar-button inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-40"
                  title="Split right"
                >
                  <Icon name="ph:columns" width={12} aria-hidden />
                  <span>Split right</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSplitTerminal("vertical")}
                  disabled={sessions.length === 0}
                  className="comux-terminal-toolbar-button inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-40"
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
                className="comux-terminal-add-button inline-grid h-[22px] w-[22px] place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
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
                    className="comux-terminal-empty-add rounded border border-[var(--border-hairline)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
                {terminalLayout.root ? renderTerminalNode(terminalLayout.root) : null}
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
            ⌘N new · ⌘W close · drag tabs or pane bars onto pane edges to split &amp; reorganize · drag dividers to resize
          </footer>
        </div>
      ) : (
        /* Project tab */
        <div className="flex flex-1 min-h-0">
          {/* Project list — collapse from its own header; a thin rail re-opens it.
              The Code layout presets also drive this (Chat hides it). */}
          {projectListCollapsed ? (
          // The whole rail is the click target — its full height re-opens the
          // list, not just the icon at the top.
          <button
            type="button"
            onClick={() => setProjectListVisible(true)}
            aria-label="Show projects list"
            title="Show projects list"
            className="flex w-[34px] shrink-0 flex-col items-center gap-1 self-stretch border-r border-[var(--border-hairline)] py-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <span className="grid h-7 w-7 place-items-center">
              <Icon name="ph:sidebar-simple" width={15} />
            </span>
            <span
              className="mt-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              Projects
            </span>
          </button>
          ) : (
          <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--border-hairline)] py-2 text-[12px]">
            <div className="mb-1 flex items-center gap-1.5 px-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Projects</span>
              <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[9px] text-[var(--text-muted)]">
                {projects.length}
              </span>
              <button
                type="button"
                onClick={() => setProjectListVisible(false)}
                aria-label="Hide projects list"
                title="Hide projects list"
                className="-my-1 ml-auto grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:sidebar-simple-fill" width={15} />
              </button>
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
          )}

          {/* Project detail */}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col">
            {selectedProject ? (
              <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
                {projectDetailCollapsed ? (
                  <button
                    type="button"
                    aria-label="Show project details"
                    title="Show project details"
                    onClick={() => setProjectDetailVisible(true)}
                    className="flex min-h-[34px] shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] xl:min-h-0 xl:w-[34px] xl:flex-col xl:self-stretch xl:border-b-0 xl:border-r xl:py-2"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center">
                      <Icon name="ph:sidebar-simple" width={15} />
                    </span>
                    <span className="comux-detail-rail-label text-[10px] font-semibold uppercase tracking-widest xl:mt-1">
                      Details
                    </span>
                  </button>
                ) : (
                  <div className="flex min-h-0 min-w-0 flex-col border-b border-[var(--border-hairline)] xl:flex-1 xl:border-b-0 xl:border-r">
                    <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
                      {/* Top row: project identity + the project-details toggle,
                          pinned to the topmost row so it never wraps below the
                          Terminal / New chat actions. */}
                      <div className="flex items-start justify-between gap-2">
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
                        <button
                          type="button"
                          aria-label="Hide project details"
                          title="Hide project details"
                          onClick={() => setProjectDetailVisible(false)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                        >
                          <Icon name="ph:sidebar-simple-fill" width={14} />
                        </button>
                      </div>
                      {/* Actions row */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => addSession(selectedProject.root)}
                          className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                        >
                          <Icon name="ph:plus" width={12} />
                          Terminal
                        </button>
                        <button
                          type="button"
                          onClick={() => onNewChat(selectedProject.root)}
                          className="flex h-7 items-center gap-1 rounded-md bg-[var(--accent-presence)] px-2.5 text-[11px] font-medium text-white hover:opacity-85"
                        >
                          <Icon name="ph:chat-circle-dots" width={12} />
                          New chat
                        </button>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {/* Project-wide code search (CODE-SEARCH-01) */}
                    <div className="mb-3">
                      <div className="relative">
                        <Icon
                          name="ph:magnifying-glass"
                          width={12}
                          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                        />
                        <input
                          type="search"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          placeholder="Search in project…"
                          aria-label="Search in project"
                          className="h-7 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/60 pl-7 pr-[3.75rem] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                        />
                        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setSearchCaseSensitive((v) => !v)}
                            aria-pressed={searchCaseSensitive}
                            title={searchCaseSensitive ? "Case-sensitive" : "Case-insensitive (smart case)"}
                            className={`rounded px-1 py-0.5 font-mono text-[10px] transition-colors ${
                              searchCaseSensitive
                                ? "bg-[var(--accent-presence,var(--bg-raised))] text-[var(--text-primary)]"
                                : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
                            }`}
                          >
                            Aa
                          </button>
                          <button
                            type="button"
                            onClick={() => setSearchRegex((v) => !v)}
                            aria-pressed={searchRegex}
                            title={searchRegex ? "Regex search on" : "Regex search off — matching literal text"}
                            className={`rounded px-1 py-0.5 font-mono text-[10px] transition-colors ${
                              searchRegex
                                ? "bg-[var(--accent-presence,var(--bg-raised))] text-[var(--text-primary)]"
                                : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
                            }`}
                          >
                            .*
                          </button>
                        </div>
                      </div>
                      {/* File-glob include filter (passes ?glob= to ripgrep). */}
                      <div className="relative mt-1.5">
                        <Icon
                          name="ph:funnel"
                          width={11}
                          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                        />
                        <input
                          type="text"
                          value={searchGlob}
                          onChange={(e) => setSearchGlob(e.target.value)}
                          placeholder="Filter files — e.g. *.ts, src/**"
                          aria-label="Filter files by glob"
                          spellCheck={false}
                          autoComplete="off"
                          className="h-7 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/60 pl-7 pr-2 font-mono text-[10px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                        />
                      </div>
                      {searchInput.trim() && (
                        <div className="mt-2">
                          {searchLoading ? (
                            <div className="flex items-center gap-2 py-1 pl-1 text-[11px] text-[var(--text-muted)]">
                              <Icon name="ph:arrow-clockwise" width={11} className="animate-spin" />
                              Searching…
                            </div>
                          ) : searchError ? (
                            <p className="py-1 pl-1 text-[11px] text-[var(--color-danger,#f87171)]">{searchError}</p>
                          ) : searchResult && searchResult.totalMatches > 0 ? (
                            <>
                              <div className="mb-1 flex items-center gap-1.5 pl-1 text-[10px] text-[var(--text-muted)]">
                                <span>
                                  {searchResult.totalMatches} {searchResult.totalMatches === 1 ? "match" : "matches"} in{" "}
                                  {searchResult.files.length} {searchResult.files.length === 1 ? "file" : "files"}
                                </span>
                                {searchResult.truncated && <span className="text-[var(--text-muted)]">· capped</span>}
                              </div>
                              <div className="space-y-1.5">
                                {searchResult.files.map((file) => (
                                  <div key={file.path}>
                                    <div
                                      className="truncate px-1 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                                      title={file.path}
                                    >
                                      {file.path}
                                    </div>
                                    <div className="space-y-px">
                                      {file.matches.map((match, i) => (
                                        <button
                                          key={`${file.path}:${match.line}:${i}`}
                                          type="button"
                                          onClick={() => openSearchMatch(file.path, match.line)}
                                          className="focus-ring-inset flex w-full items-baseline gap-2 rounded px-1 py-[3px] text-left transition-colors hover:bg-[var(--bg-raised)]"
                                          title={`${file.path}:${match.line}`}
                                        >
                                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                                            {match.line}
                                          </span>
                                          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-primary)]">
                                            {match.preview.trim()}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="py-1 pl-1 text-[11px] text-[var(--text-muted)]">No matches.</p>
                          )}
                        </div>
                      )}
                    </div>

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
                )}

                {filePreviewCollapsed ? (
                  <button
                    type="button"
                    aria-label="Show file preview"
                    title="Show file preview"
                    onClick={() => setFilePreviewVisible(true)}
                    className="flex min-h-[34px] shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] xl:min-h-0 xl:w-[34px] xl:flex-col xl:self-stretch xl:border-b-0 xl:border-l xl:py-2"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center">
                      <Icon name="ph:sidebar-simple" width={15} />
                    </span>
                    <span className="comux-detail-rail-label text-[10px] font-semibold uppercase tracking-widest xl:mt-1">
                      Preview
                    </span>
                  </button>
                ) : (
                  <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">
                  {/* Files / Changes toggle — review the familiar's working-tree
                      diffs (revert + checkpoints) without leaving the surface. */}
                  <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-1.5">
                    <div className="flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => { pinnedRightViewRef.current = true; setRightView("files"); }}
                        className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 transition-colors ${rightView === "files" ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                      >
                        <Icon name="ph:file-code" width={11} />
                        Files
                      </button>
                      <button
                        type="button"
                        onClick={() => { pinnedRightViewRef.current = true; setRightView("changes"); }}
                        className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 transition-colors ${rightView === "changes" ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                      >
                        <Icon name="ph:git-diff" width={11} />
                        Changes
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="Hide file preview"
                      title="Hide file preview"
                      onClick={() => setFilePreviewVisible(false)}
                      className="ml-auto mr-8 grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] xl:mr-9"
                    >
                      <Icon name="ph:sidebar-simple-fill" width={14} />
                    </button>
                  </div>
                  {rightView === "changes" ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <SessionChangesInner
                        key={selectedProject.root}
                        projectRoot={selectedProject.root}
                        running={projectHasRunningSession}
                        focusPath={focusDiff?.path ?? null}
                        focusNonce={focusDiff?.nonce}
                      />
                    </div>
                  ) : previewPath ? (
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
                        {previewLangLabel && (
                          <span className="comux-preview-lang shrink-0 rounded-[5px] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                            {previewLangLabel}
                          </span>
                        )}
                        {preview?.kind === "text" && (
                          <span className="hidden shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--text-muted)] sm:flex">
                            <span>{previewLineCount.toLocaleString()} {previewLineCount === 1 ? "line" : "lines"}</span>
                            {formatBytes(preview.size) && <span>· {formatBytes(preview.size)}</span>}
                          </span>
                        )}
                        {!editing && previewIsMarkdown && (
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
                        {editing ? (
                          <>
                            {saveError && (
                              <span className="shrink-0 truncate text-[10px] text-[var(--color-danger,#f87171)]" title={saveError}>
                                {saveError}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={saving}
                              className="focus-ring flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:opacity-30"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEdit()}
                              disabled={saving}
                              className="focus-ring flex shrink-0 items-center gap-1 rounded border border-[var(--border-hairline)] bg-[var(--accent-presence,var(--bg-raised))] px-2 py-0.5 text-[10px] text-[var(--text-primary)] transition-colors hover:opacity-90 disabled:opacity-40"
                            >
                              <Icon name={saving ? "ph:arrow-clockwise" : "ph:floppy-disk-bold"} width={11} className={saving ? "animate-spin" : ""} />
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </>
                        ) : (
                          <>
                            {justSaved && (
                              <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--color-success)]">
                                <Icon name="ph:check" width={11} aria-hidden />
                                Saved
                              </span>
                            )}
                            {previewEditable && (
                              <button
                                type="button"
                                onClick={startEditing}
                                className="focus-ring flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
                              >
                                <Icon name="ph:pencil-simple" width={11} />
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={copyPreview}
                              disabled={!preview || preview.kind !== "text"}
                              className="focus-ring flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] disabled:opacity-30"
                            >
                              <Icon name="ph:copy" width={11} />
                              {copied ? "Copied" : "Copy"}
                            </button>
                          </>
                        )}
                      </div>
                      {/* Preview content */}
                      <div className="comux-file-preview min-h-0 flex-1 overflow-auto p-3">
                        {previewLoading ? (
                          <div className="space-y-2.5" aria-label="Loading file" aria-busy="true">
                            {["94%", "88%", "97%", "72%", "90%", "83%", "60%"].map((w, i) => (
                              <Skeleton key={i} variant="text" width={w} />
                            ))}
                          </div>
                        ) : previewError ? (
                          <ErrorState
                            compact
                            headline="Couldn't open this file"
                            subtitle={previewError}
                            actions={
                              <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => { if (previewPath) void openFilePreview(previewPath, previewLine); }}>
                                Retry
                              </Button>
                            }
                          />
                        ) : editing ? (
                          <div className="h-full overflow-hidden rounded-md border border-[var(--border-hairline)]">
                            <CodeEditor
                              value={editValue}
                              filename={previewPath.split("/").pop() ?? ""}
                              onChange={setEditValue}
                              onSave={() => void saveEdit()}
                              onCancel={cancelEditing}
                            />
                          </div>
                        ) : (
                          preview?.kind === "error" ? (
                            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-hairline)] bg-[var(--bg-base)] p-4 text-center" role="alert">
                              <Icon name="ph:warning-circle" width={28} className="text-[var(--color-danger)] opacity-80" />
                              <p className="text-[12px] text-[var(--text-secondary)]">{preview.message}</p>
                              {previewPath ? (
                                <p className="font-mono text-[10px] text-[var(--text-muted)]">{previewPath.split("/").pop()}</p>
                              ) : null}
                            </div>
                          ) : preview?.kind === "image" ? (
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
                              highlightLine={previewLine}
                              className="leading-relaxed"
                            />
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <EmptyState
                        icon="ph:file"
                        headline="Select a file to preview"
                        subtitle="Pick a file from the tree to read or edit it here."
                      />
                    </div>
                  )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon="ph:folder-open"
                  headline="No projects found yet"
                  subtitle="Projects appear here once a familiar has worked in a directory."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
