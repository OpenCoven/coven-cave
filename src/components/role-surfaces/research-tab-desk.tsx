"use client";

/**
 * Desk tab — the mission workspace (cave-dl74 B2): command toolbar, runs
 * rail, mission detail (center column + evidence rail), and the load-error
 * banner.
 *
 * Command-bar contract: only commands with REAL destinations exist.
 *   /brief /sweep /paper — Prompt tab with that mode preselected
 *   /deep               — Prompt tab with the deep loop ("autoresearch")
 *   /save               — Resources tab
 *   /find <query>       — live-filters the runs rail by the remainder
 *   /chat               — opens the selected mission's latest session
 *                         (offered only when that session actually exists)
 * There is no /task — no board-create destination is reachable from here.
 *
 * Plain text is kept as a live runs filter. New research has one persistent
 * destination in the toolbar, so filtering never masquerades as composing.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SearchInput } from "@/components/ui/search-input";
import { Icon } from "@/lib/icon";
import {
  filterResearchMissionsByText,
  researchMissionScopeCounts,
  type ResearchMissionScope,
} from "./research-desk-view";
import { ResearchMissionDetail } from "./research-mission-detail";
import { ResearchMissionList } from "./research-mission-list";
import type { ResearchTabProps } from "./researcher-surface";
import { useResearchPane } from "./use-research-pane";

type DeskCommand = {
  cmd: string;
  label: string;
  hint: string;
  run(): void;
  /** /find keeps the bar text (the query is the filter); others clear it. */
  keepsQuery?: boolean;
};

const FOCUS_STORAGE_PREFIX = "cave:research:desk-focus:";

/** Scope chips. `tone` drives the leading status dot; "all" has none because
 *  it is a reset, not a state. */
const SCOPES: Array<{ id: ResearchMissionScope; label: string; tone?: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active", tone: "active" },
  { id: "needs-review", label: "Needs review", tone: "needs-review" },
  { id: "finished", label: "Finished", tone: "finished" },
];

/** Rail sizing. Both clamp on read, so a stale stored width cannot wedge a
 *  rail off screen (see use-research-pane). */
const QUEUE_PANE = {
  storageKey: "cave:research:desk-queue-width",
  min: 230,
  max: 440,
  initial: 296,
  direction: 1,
} as const;

function readFocusMode(familiarId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(
      `${FOCUS_STORAGE_PREFIX}${familiarId}`,
    ) === "true";
  } catch {
    return false;
  }
}

export function ResearchTabDesk({ research, context, onNavigate }: ResearchTabProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ResearchMissionScope>("all");
  const familiarId = context.activeFamiliar.id;
  const [focusMode, setFocusMode] = useState(() =>
    readFocusMode(familiarId));
  const queue = useResearchPane(QUEUE_PANE);
  // The evidence rail collapses independently of focus mode: focus hides both
  // rails for reading, this keeps the queue while widening the run.
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const { announce } = useAnnouncer();

  const selectedSessionId = research.selected?.iterations.at(-1)?.sessionId;
  const openMissionSession = (sessionId: string) => {
    context.openSession(sessionId, context.activeFamiliar.id);
  };

  // Rebuilt per render (cheap, tiny list) so every closure sees live context.
  const commands: DeskCommand[] = [
    { cmd: "/brief", label: "Quick brief", hint: "Prompt · brief mode", run: () => onNavigate("prompt", { mode: "brief" }) },
    { cmd: "/sweep", label: "Landscape sweep", hint: "Prompt · sweep mode", run: () => onNavigate("prompt", { mode: "sweep" }) },
    { cmd: "/paper", label: "Deep paper", hint: "Prompt · paper mode", run: () => onNavigate("prompt", { mode: "paper" }) },
    { cmd: "/deep", label: "Deep research loop", hint: "Prompt · deep loop", run: () => onNavigate("prompt", { mode: "autoresearch" }) },
    { cmd: "/save", label: "Saved resources", hint: "Resources tab", run: () => onNavigate("resources") },
    {
      cmd: "/find",
      label: "Filter runs",
      hint: "/find <query>",
      keepsQuery: true,
      run: () => setQuery("/find "),
    },
    // /chat only exists while it has a real destination: the selected
    // mission's latest iteration session.
    ...(selectedSessionId ? [{
      cmd: "/chat",
      label: "Discuss selected run in chat",
      hint: research.selected?.title ?? "",
      run: () => openMissionSession(selectedSessionId),
    }] : []),
  ];

  // "/find rest-of-text" and plain text both live-filter the runs rail.
  const isCommandText = query.startsWith("/");
  const findMatch = /^\/find\s+(.*)$/i.exec(query);
  const listFilter = findMatch ? findMatch[1] : isCommandText ? "" : query;
  const scopeCounts = useMemo(
    () => researchMissionScopeCounts(
      filterResearchMissionsByText(research.missions, listFilter),
    ),
    [research.missions, listFilter],
  );
  const commandsOpen = isCommandText && !findMatch;
  const commandToken = commandsOpen ? query.slice(1).split(/\s+/)[0].toLowerCase() : "";
  const visibleCommands = commandsOpen
    ? commands.filter((command) => command.cmd.slice(1).startsWith(commandToken))
    : [];

  useEffect(() => {
    setQuery("");
    setScope("all");
    setFocusMode(readFocusMode(familiarId));
  }, [familiarId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "/"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.repeat
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
      setQuery("/");
      queryInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runCommand = (command: DeskCommand) => {
    command.run();
    if (!command.keepsQuery) setQuery("");
  };

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (event.key === "Enter" && commandsOpen && visibleCommands.length > 0) {
      event.preventDefault();
      runCommand(visibleCommands[0]);
    }
  };

  const toggleFocusMode = () => {
    const next = !focusMode;
    setFocusMode(next);
    try {
      window.localStorage.setItem(
        `${FOCUS_STORAGE_PREFIX}${familiarId}`,
        String(next),
      );
    } catch {
      // The workspace mode still applies for this visit.
    }
    announce(next ? "Focus mode enabled." : "Workspace rails restored.");
  };

  return (
    <div className="research-desk-tab">
      <div className="research-desk-toolbar">
        <div className="research-desk-toolbar__main">
          <SearchInput
            ref={queryInputRef}
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            onKeyDown={onQueryKeyDown}
            placeholder="Filter runs…"
            aria-label="Filter research runs"
            aria-keyshortcuts="/"
            aria-expanded={commandsOpen}
            aria-controls={commandsOpen ? "research-desk-commands" : undefined}
            containerClassName="research-desk-toolbar__search"
            spellCheck={false}
          />
          <span className="research-desk-toolbar__summary" role="status">
            {scopeCounts.active} active · {scopeCounts["needs-review"]} need review
          </span>
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={focusMode}
            onClick={toggleFocusMode}
          >
            {focusMode ? "Show workspace" : "Focus run"}
          </Button>
          <Button
            size="xs"
            variant="primary"
            onClick={() => onNavigate("prompt")}
          >
            New research
          </Button>
        </div>
        {commandsOpen ? (
          <div
            id="research-desk-commands"
            className="research-desk-querybar__popover"
            role="menu"
            aria-label="Desk commands"
          >
            {visibleCommands.length === 0 ? (
              <p className="research-desk-querybar__none">No matching command</p>
            ) : (
              visibleCommands.map((command) => (
                <button
                  key={command.cmd}
                  type="button"
                  role="menuitem"
                  className="research-desk-querybar__command"
                  onClick={() => runCommand(command)}
                >
                  <code>{command.cmd}</code>
                  <span>{command.label}</span>
                  <em>{command.hint}</em>
                </button>
              ))
            )}
          </div>
        ) : null}
        <div
          className="research-desk-toolbar__scopes"
          role="group"
          aria-label="Filter runs by status"
        >
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="research-desk-scope focus-ring"
              aria-pressed={scope === item.id}
              aria-label={`${item.label}, ${scopeCounts[item.id]} ${scopeCounts[item.id] === 1 ? "run" : "runs"}`}
              data-zero={scopeCounts[item.id] === 0}
              onClick={() => setScope(item.id)}
            >
              {item.tone ? (
                <i className="research-desk-scope__dot" data-tone={item.tone} aria-hidden />
              ) : null}
              <span>{item.label}</span>
              <span aria-hidden>{scopeCounts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className="research-desk__workspace"
        data-focus-mode={focusMode}
        data-queue-collapsed={queue.collapsed}
        style={{ "--research-queue-width": `${queue.width}px` } as CSSProperties}
      >
        {queue.collapsed ? (
          <button
            type="button"
            className="research-desk-spine focus-ring"
            aria-expanded={false}
            aria-label={`Open the run queue — ${research.missions.length} ${research.missions.length === 1 ? "run" : "runs"}`}
            onClick={() => queue.setCollapsed(false)}
          >
            <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
            <span className="research-desk-spine__badge" aria-hidden>{research.missions.length}</span>
            <span className="research-desk-spine__label" aria-hidden>Run queue</span>
          </button>
        ) : (
          <>
            <ResearchMissionList
              missions={research.missions}
              selectedId={research.selectedId}
              loading={research.loading}
              onSelect={research.select}
              filter={listFilter}
              scope={scope}
              onCollapse={() => queue.setCollapsed(true)}
              onClearFilters={() => {
                setQuery("");
                setScope("all");
              }}
            />
            <div
              {...queue.separatorProps}
              className="research-desk-handle"
              aria-label="Resize the run queue"
              title="Drag, or use arrow keys, to resize the run queue"
            />
          </>
        )}
        <main className="research-desk__main">
          {research.error ? (
            <div className="research-desk__error" role="alert">
              <span>{research.error}</span>
              <Button size="xs" variant="ghost" onClick={() => void research.load()}>
                Try again
              </Button>
            </div>
          ) : null}
          <ResearchMissionDetail
            mission={research.selected}
            showEvidence={!focusMode && evidenceOpen}
            onCollapseEvidence={focusMode ? undefined : () => setEvidenceOpen(false)}
            onOpenEvidence={focusMode ? undefined : () => setEvidenceOpen(true)}
            onOpenSession={(sessionId) => {
              context.openSession(sessionId, context.activeFamiliar.id);
            }}
            onOpenUrl={context.openUrl}
            onShowResources={() => onNavigate("resources")}
            onAction={(input) => research.selected
              ? research.act(research.selected.id, input)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onSchedule={(rrule) => research.selected
              ? research.schedule(research.selected.id, rrule)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onAutomationAction={(automationId, action) => research.selected
              ? research.controlAutomation(research.selected.id, automationId, action)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
          />
        </main>
      </div>
    </div>
  );
}
