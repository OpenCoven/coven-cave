"use client";

import type { SessionRow } from "@/lib/types";
import { chatProjectName, type ChatProjectGroup } from "@/lib/chat-projects";
import { selectionKey, type ProjectSelection } from "@/lib/chat-project-selection";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { Icon } from "@/lib/icon";

type Props = {
  groups: ChatProjectGroup[];
  selection: ProjectSelection;
  expandedKeys: string[];
  open: boolean;
  activeSessionId?: string | null;
  onSetOpen: (open: boolean) => void;
  onSelect: (selection: ProjectSelection) => void;
  onToggleExpanded: (key: string) => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
};

function statusDotClass(status: string): string {
  if (status === "running") return "animate-pulse bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

function AccentBar({ tall }: { tall?: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 top-1/2 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent-presence)] ${tall ? "h-5" : "h-4"}`}
    />
  );
}

export function ChatProjectSidebar({
  groups,
  selection,
  expandedKeys,
  open,
  activeSessionId,
  onSetOpen,
  onSelect,
  onToggleExpanded,
  onOpenSession,
  onNewChat,
}: Props) {
  if (!open) {
    return (
      <aside className="hidden shrink-0 border-r border-[var(--border-hairline)] lg:flex">
        <button
          type="button"
          onClick={() => onSetOpen(true)}
          title="Show projects"
          aria-label="Show projects"
          aria-expanded={false}
          className="focus-ring flex w-7 flex-col items-center pt-3 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:sidebar-simple" width={14} aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[210px] shrink-0 flex-col border-r border-[var(--border-hairline)] lg:flex">
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Projects
        </span>
        <button
          type="button"
          onClick={() => onSetOpen(false)}
          title="Hide projects"
          aria-label="Hide projects"
          aria-expanded
          className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:sidebar-simple-fill" width={13} aria-hidden />
        </button>
      </div>

      <nav aria-label="Projects" className="min-h-0 flex-1 overflow-y-auto pb-2">
        <button
          type="button"
          onClick={() => onSelect("all")}
          aria-current={selection === "all" ? "true" : undefined}
          className={[
            "relative flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
            selection === "all"
              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
          ].join(" ")}
        >
          {selection === "all" ? <AccentBar tall /> : null}
          <Icon name="ph:chats" width={13} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">All chats</span>
        </button>

        {groups.map((group) => {
          const key = selectionKey(group.projectRoot);
          const expanded = expandedKeys.includes(key);
          const isSelected = selection === key;
          const label = chatProjectName(group.projectRoot);
          return (
            <div key={key}>
              <div
                className={[
                  "group relative flex w-full items-center gap-1 pr-2 transition-colors",
                  isSelected ? "bg-[var(--bg-raised)]" : "hover:bg-[var(--bg-raised)]/50",
                ].join(" ")}
              >
                {isSelected ? <AccentBar tall /> : null}
                <button
                  type="button"
                  onClick={() => onToggleExpanded(key)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${label} sessions`}
                  className="focus-ring ml-1 grid h-6 w-4 shrink-0 place-items-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={isSelected ? "true" : undefined}
                  className={[
                    "flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[12px] transition-colors",
                    isSelected
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  <Icon
                    name={isSelected ? "ph:folder-open" : "ph:folder"}
                    width={13}
                    aria-hidden
                    className="shrink-0 text-[var(--text-muted)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                    {group.sessions.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onNewChat(group.projectRoot)}
                  title={`New chat in ${label}`}
                  aria-label={`New chat in ${label}`}
                  className="touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] group-hover:opacity-100"
                >
                  <Icon name="ph:plus" width={11} aria-hidden />
                </button>
              </div>
              {expanded ? (
                <ul>
                  {group.sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          onClick={() => onOpenSession(session)}
                          aria-current={isActive ? "true" : undefined}
                          className={[
                            "relative flex w-full items-center gap-2 py-1 pl-7 pr-2 text-left text-[11px] transition-colors",
                            isActive
                              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
                          ].join(" ")}
                        >
                          {isActive ? <AccentBar /> : null}
                          <span
                            aria-hidden
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {stripLeadingTrailingEmoji(session.title || "(untitled chat)")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
