"use client";

import "@/styles/board.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { DEMO_MODE_EVENT, isDemoModeEnabled } from "@/lib/demo-mode";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";
import { type Card, type CardStatus } from "@/lib/cave-board-types";
import { cardMatchesBoardSearch } from "@/lib/board-search";
import { BoardKanban } from "@/components/board-kanban";
import { BoardTable, type GroupBy } from "@/components/board-table";
import { BoardCardStack } from "@/components/board-card-stack";
import { BoardInspector } from "@/components/board-inspector";
import { useIsMobile } from "@/lib/use-viewport";
import { chatProjectById } from "@/lib/chat-projects";
import type { CaveProject } from "@/lib/cave-projects";
import { useProjects } from "@/lib/use-projects";

type ViewMode = "kanban" | "table";

function loadPref<T extends string>(key: string, fallback: T, valid: T[]): T {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key) as T | null;
  return v !== null && valid.includes(v) ? v : fallback;
}

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenUrl?: (url: string) => void;
};

export function BoardView({ familiars, sessions, activeFamiliarId, onJumpToSession, onOpenUrl }: Props) {
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Distinguish "still loading" from "loaded and empty" so the empty-state
  // CTA doesn't flash on every open before the first GET resolves.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Transient feedback when an optimistic mutation fails and is reverted.
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadPref("cave:board:viewMode", "kanban", ["kanban", "table"]));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref("cave:board:groupBy", "status", ["status", "familiar"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");
  const [chatLinkingId, setChatLinkingId] = useState<string | null>(null);
  const [chatLinkError, setChatLinkError] = useState<string | null>(null);
  // Card awaiting a project selection before its task chat starts — only set
  // for cards with no persisted project root and no session yet.
  const [cwdPromptCardId, setCwdPromptCardId] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const { projects } = useProjects();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as Card[];
        // Demo mode only seeds when the API actually returned ok+empty.
        // On error, fall through so the user sees the failure.
        setCards(isDemoModeEnabled() && loaded.length === 0 ? DEMO_BOARD_CARDS : loaded);
        setError(null);
      } else {
        setCards([]);
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      setCards([]);
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onDemoModeChange = () => { void load(); };
    window.addEventListener(DEMO_MODE_EVENT, onDemoModeChange);
    return () => window.removeEventListener(DEMO_MODE_EVENT, onDemoModeChange);
  }, [load]);
  useEffect(() => { localStorage.setItem("cave:board:viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("cave:board:groupBy", groupBy); }, [groupBy]);

  // External create paths dispatch `cave:board:reload` after POST so the board
  // picks up the new card without a full surface remount.
  useEffect(() => {
    const onReload = () => { void load(); };
    window.addEventListener("cave:board:reload", onReload);
    return () => window.removeEventListener("cave:board:reload", onReload);
  }, [load]);

  // Honour `#card-<id>` in the URL: workspace's `focus-card` palette intent
  // (e.g. the Task chip in chat-view) routes to /?…#card-<id>; we pick that
  // up here and open the inspector for the matching card. We wait until the
  // target card has loaded into `cards` before consuming the hash — otherwise
  // the cleanup effect just below would null `selectedCardId` on the next
  // render because the card isn't in the (empty) cards array yet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const match = /^#card-(.+)$/.exec(window.location.hash);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      if (!cards.some((c) => c.id === id)) return;
      setSelectedCardId(id);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [cards]);

  const familiarsById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (activeFamiliarId === null || c.familiarId === activeFamiliarId) &&
          cardMatchesBoardSearch(c, searchQuery, familiarsById),
      ),
    [cards, familiarsById, searchQuery, activeFamiliarId],
  );

  const stats = useMemo(() => ({
    total: filtered.length,
    running: filtered.filter((c) => c.status === "running").length,
    blocked: filtered.filter((c) => c.status === "blocked" || c.needsHuman).length,
  }), [filtered]);

  const tableGroupBy: GroupBy = activeFamiliarId === null ? groupBy : "status";
  const showTableGroupToggle = !isMobile && viewMode === "table" && activeFamiliarId === null;

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId) ?? null, [cards, selectedCardId]);

  useEffect(() => {
    if (selectedCardId && !cards.some((c) => c.id === selectedCardId)) setSelectedCardId(null);
  }, [cards, selectedCardId]);

  const lifecycleForStatus = (status: CardStatus) => {
    if (status === "running") return "running" as const;
    if (status === "review") return "review" as const;
    if (status === "blocked") return "failed" as const;
    if (status === "done") return "completed" as const;
    return "queued" as const;
  };

  const patchCard = async (id: string, patch: Partial<Card>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    try {
      const res = await fetch(`/api/board/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const json = await res.json();
      if (!json.ok) {
        // Revert to the server copy and tell the user — an optimistic change
        // that silently snaps back reads as a glitch.
        setActionError(json.error ? `Couldn't save changes — ${json.error}` : "Couldn't save changes — reverted to the server copy.");
        await load();
      } else {
        setActionError(null);
      }
    } catch {
      setActionError("Couldn't reach the server — your change was reverted.");
      await load();
    }
  };

  const moveCardToStatus = (id: string, status: CardStatus) => {
    const patch: Partial<Card> = { status, lifecycle: lifecycleForStatus(status), needsHuman: status === "blocked" };
    if (status === "running") (patch as Record<string, unknown>).runningSince = new Date().toISOString();
    void patchCard(id, patch);
  };

  const create = async (draft: NewCardDraft) => {
    const res = await fetch("/api/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "create failed");
    await load();
  };

  const removeCard = async (id: string) => {
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) { if (selectedCardId === id) setSelectedCardId(null); await load(); }
  };

  const startTaskChat = async (id: string, projectRoot?: string) => {
    const card = cards.find((candidate) => candidate.id === id);
    const fallbackFamiliarId = card?.familiarId ?? activeFamiliarId ?? familiars[0]?.id ?? null;
    setChatLinkingId(id);
    setChatLinkError(null);
    try {
      const res = await fetch(`/api/board/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: fallbackFamiliarId,
          ...(projectRoot ? { projectRoot } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "failed to open task chat");
      if (json.card) {
        setCards((prev) => prev.map((candidate) => candidate.id === id ? json.card : candidate));
      }
      onJumpToSession?.(json.sessionId, json.familiarId);
    } catch (err) {
      setChatLinkError(err instanceof Error ? err.message : "failed to open task chat");
    } finally {
      setChatLinkingId(null);
    }
  };

  const onOpenTaskChat = async (id: string) => {
    const card = cards.find((candidate) => candidate.id === id);
    // Task chats run in the task's project root. When the card doesn't have one
    // yet (and there's no session to reattach to), ask which known project to use.
    if (card && !card.sessionId && !card.cwd) {
      setCwdPromptCardId(id);
      return;
    }
    await startTaskChat(id);
  };

  const handleEnrichSteps = async () => {
    setEnriching(true);
    setEnrichProgress(null);
    try {
      const res = await fetch("/api/board/enrich-steps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-coven-cave-intent": "board-enrich-steps",
        },
        body: JSON.stringify({ intent: "board-enrich-steps" }),
      });
      if (!res.ok) throw new Error(`enrich steps failed (${res.status})`);
      if (!res.body) throw new Error("enrich steps: missing response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.kind === "start") {
              setEnrichProgress({ done: 0, total: (msg.total as number) ?? 0 });
            } else if (msg.kind === "done" || msg.kind === "skip") {
              setEnrichProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
            } else if (msg.kind === "complete") {
              await load();
            }
          } catch { /* */ }
        }
      }
      setEnriching(false);
    } catch {
      setEnriching(false);
    }
  };

  return (
    <section className="board-shell">
      {/* Header */}
      <header className="board-header">
        <span className="board-header-title">Tasks</span>
        <div className="board-search-wrap">
          <Icon name="ph:magnifying-glass" width={13} className="board-search-icon" />
          <label className="sr-only" htmlFor="board-search">Search tasks</label>
          <input
            id="board-search"
            className="board-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search tasks or type is:open cwd:coven-cave url:github'
          />
          {searchQuery ? (
            <button
              type="button"
              className="board-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear task search"
            >
              <Icon name="ph:x-bold" width={10} />
            </button>
          ) : null}
        </div>
        <div className="board-header-controls">
          {/* Grouping only applies to the table view — kanban always uses
              status columns, so the toggle would be noise there. */}
          {showTableGroupToggle ? (
            <div className="board-group-toggle" role="group" aria-label="Group tasks by">
            <button
              type="button"
              className={`board-group-toggle-btn${groupBy === "status" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("status")}
              aria-pressed={groupBy === "status"}
            >
              Status
            </button>
            <button
              type="button"
              className={`board-group-toggle-btn${groupBy === "familiar" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("familiar")}
              aria-pressed={groupBy === "familiar"}
            >
              Familiar
            </button>
            </div>
          ) : null}

          {/* Kanban/Table toggle — hidden on phones; BoardCardStack
              replaces both at <768px (see render branch below). */}
          <div className="board-view-toggle hidden md:flex" role="group" aria-label="Tasks view mode">
            <button type="button" aria-label="Kanban view"
              className={`board-view-toggle-btn${viewMode === "kanban" ? " board-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("kanban")}>
              <Icon name="ph:columns" width={14} />
            </button>
            <button type="button" aria-label="Table view"
              className={`board-view-toggle-btn${viewMode === "table" ? " board-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("table")}>
              <Icon name="ph:rows" width={14} />
            </button>
          </div>

          <button
            type="button"
            className="board-toolbar-btn"
            onClick={handleEnrichSteps}
            disabled={enriching || cards.length === 0}
            title="Ask each familiar to populate steps for their assigned tasks"
          >
            <Icon name="ph:sparkle" width={13} />
            {enriching
              ? enrichProgress
                ? `${enrichProgress.done}/${enrichProgress.total}`
                : "Starting…"
              : "Enrich steps"}
          </button>
                    <button type="button" className="board-new-card-btn"
            onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}>
            + New task
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-danger)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{error}</span>
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_38%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:arrow-clockwise" width={12} aria-hidden />
            Retry
          </button>
        </div>
      )}
      {chatLinkError && (
        <div
          role="alert"
          className="flex items-center gap-1.5 border-b border-[color-mix(in_oklch,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-warning)]"
        >
          <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{chatLinkError}</span>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-warning)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{actionError}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="focus-ring shrink-0 rounded p-0.5 text-[var(--color-warning)] transition-opacity hover:opacity-70"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {!hasLoaded && !error ? (
          <div className="flex h-full items-center justify-center p-6" role="status" aria-label="Loading tasks">
            <Icon name="ph:circle-notch-bold" width={20} className="animate-spin text-[var(--text-muted)]" aria-hidden />
          </div>
        ) : cards.length === 0 && !error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-6 text-center">
              <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                <Icon name="ph:kanban" width={18} aria-hidden />
              </span>
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Queue your first task</h2>
              <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                The board collects work in flight across your familiars. Add a task and assign it to whoever should pick it up &mdash; chat threads can link back to it later.
              </p>
              <button
                type="button"
                onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
              >
                <Icon name="ph:plus-bold" width={12} />
                New task
              </button>
            </div>
          </div>
        ) : isMobile ? (
          <BoardCardStack cards={filtered} familiars={familiars} sessions={sessions}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onMoveStatus={moveCardToStatus}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : viewMode === "kanban" ? (
          <BoardKanban cards={filtered} familiars={familiars} sessions={sessions}
            groupBy="status" selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} onMoveStatus={moveCardToStatus}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : (
          <BoardTable cards={filtered} familiars={familiars}
            groupBy={tableGroupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onPatch={patchCard} />
        )}
      </div>

      {/* Inspector drawer */}
      {selectedCard && (
        <BoardInspector card={selectedCard} familiars={familiars} sessions={sessions}
          onClose={() => setSelectedCardId(null)}
          onPatch={patchCard}
          onMoveStatus={moveCardToStatus}
          onDelete={removeCard}
          onCardReplaced={(next) => setCards((prev) => prev.map((c) => (c.id === next.id ? next : c)))}
          onJumpToSession={onJumpToSession}
          onOpenTaskChat={onOpenTaskChat}
          onOpenUrl={onOpenUrl}
          chatLinking={chatLinkingId === selectedCard.id}
          chatLinkError={chatLinkingId === null && !selectedCard.sessionId ? chatLinkError : null}
        />
      )}

      <NewCardModal open={modalOpen} onClose={() => setModalOpen(false)}
        familiars={familiars} sessions={sessions}
        defaultStatus={modalDefaultStatus} defaultFamiliarId={activeFamiliarId}
        onCreate={create} />

      {cwdPromptCardId && (
        <TaskChatCwdPrompt
          cardTitle={cards.find((c) => c.id === cwdPromptCardId)?.title ?? ""}
          projects={projects}
          onCancel={() => setCwdPromptCardId(null)}
          onStart={(projectRoot) => {
            const id = cwdPromptCardId;
            setCwdPromptCardId(null);
            void startTaskChat(id, projectRoot);
          }}
        />
      )}
    </section>
  );
}

// ── TaskChatCwdPrompt ─────────────────────────────────────────────────────────
// Shown when a task chat is started for a card with no project root: lets the
// user choose a known project, which is persisted onto the card as its cwd.

function TaskChatCwdPrompt({
  cardTitle,
  projects,
  onCancel,
  onStart,
}: {
  cardTitle: string;
  projects: CaveProject[];
  onCancel: () => void;
  onStart: (projectRoot?: string) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const firstProject = projects[0] ?? null;
  const selectedProject = projectId ? chatProjectById(projectId, projects) ?? firstProject : firstProject;

  useEffect(() => {
    setProjectId((current) => current ?? firstProject?.id ?? null);
  }, [firstProject?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    if (selectedProject) onStart(selectedProject.root);
  };

  return (
    <div
      // Above the board inspector drawer (z-index 301 in board.css), which can
      // be open underneath when the chat starts from the drawer's CTA.
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Select a project for this task chat"
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
          <Icon name="ph:folder-open" width={14} aria-hidden />
          Select a project
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {cardTitle ? <>“{cardTitle}” has</> : <>This task has</>} no project yet.
          Pick the project this task belongs to; the selected project is saved on the task and used for the chat session.
        </p>
        <label className="focus-within:border-[var(--border-strong)] mb-2 flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-2">
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase text-[var(--text-muted)]">Project</span>
          <select
            autoFocus
            value={selectedProject?.id ?? ""}
            onChange={(e) => setProjectId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            aria-label="Project for this task chat"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--text-primary)] outline-none"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mb-4 truncate rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/45 px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-muted)]">
          {selectedProject?.root ?? "No projects available"}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!selectedProject}
            className="focus-ring rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Start chat
          </button>
        </div>
      </div>
    </div>
  );
}
