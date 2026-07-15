"use client";

import { useState } from "react";

import { ProjectAvatar } from "@/components/project-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem } from "@/components/ui/popover";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import type { SessionRow } from "@/lib/types";
import { deriveProjectStatus } from "@/lib/project-status";

import {
  chatDotClass,
  hasDesktopBridge,
  lastActiveMs,
  revealProjectFolder,
} from "./projects-shared";

// The hub's master list: one compact row per project. Selecting a row swaps the
// detail pane; everything heavier (rename, path, sessions, delete) lives there.
// Rows are options in a listbox — the roving tabindex + type-ahead handlers in
// the shell move focus over [data-proj-nav]; Enter/Space/click select.

type ProjectListProps = {
  projects: CaveProject[];
  chatsByRoot: Map<string, SessionRow[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** ArrowRight on a row: after selecting, hand focus into the detail pane. */
  onEnterDetail?: () => void;
  onNewChat?: (projectRoot: string) => void;
};

export function ProjectList({ projects, chatsByRoot, selectedId, onSelect, onEnterDetail, onNewChat }: ProjectListProps) {
  return (
    <ul role="listbox" aria-label="Projects" className="m-0 flex list-none flex-col gap-px p-0">
      {projects.map((project) => (
        <ProjectListRow
          key={project.id}
          project={project}
          chats={chatsByRoot.get(normalizeProjectRoot(project.root)) ?? []}
          selected={project.id === selectedId}
          onSelect={() => onSelect(project.id)}
          onEnterDetail={onEnterDetail}
          onNewChat={onNewChat}
        />
      ))}
    </ul>
  );
}

function ProjectListRow({
  project,
  chats,
  selected,
  onSelect,
  onEnterDetail,
  onNewChat,
}: {
  project: CaveProject;
  chats: SessionRow[];
  selected: boolean;
  onSelect: () => void;
  onEnterDetail?: () => void;
  onNewChat?: (projectRoot: string) => void;
}) {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [copied, setCopied] = useState(false);
  const status = deriveProjectStatus(chats);
  const statusLabel =
    status === "running"
      ? ", a session is running"
      : status === "failed"
        ? ", last session failed"
        : status === "recent"
          ? ", active recently"
          : "";
  const lastMs = lastActiveMs(chats);
  const lastIso = lastMs > 0 ? new Date(lastMs).toISOString() : project.updatedAt;

  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(project.root);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  };

  return (
    <li className="m-0 list-none p-0">
      <div
        role="option"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        data-proj-nav
        data-proj-label={project.name}
        id={`pcard-el:${normalizeProjectRoot(project.root)}`}
        aria-label={`${project.name}${statusLabel}`}
        className="focus-ring projects-list-row"
        onClick={onSelect}
        onKeyDown={(e) => {
          // ARIA option pattern: Enter and Space both select; → additionally
          // hands focus into the detail pane (which also reveals it under the
          // narrow single-pane collapse). ← in the detail hands focus back.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onSelect();
            onEnterDetail?.();
          }
        }}
        onContextMenu={openContextMenuAt(setMenu)}
      >
        <ProjectAvatar name={project.name} root={project.root} color={project.color} size="sm" />
        <span className="projects-list-row__name" title={project.root}>
          {project.name}
        </span>
        <span className="projects-list-row__meta">
          {chats.length > 0 ? <span className="projects-list-row__count">{chats.length}</span> : null}
          <RelativeTime iso={lastIso} className="tabular-nums" />
          {status ? (
            <span
              className={`projects-status-dot ${chatDotClass(status)}${status === "running" ? " animate-pulse" : ""}`}
              role="img"
              aria-label={`Latest chat ${status}`}
              title={`Latest chat in this project: ${status}`}
            />
          ) : null}
        </span>
      </div>
      <ContextMenu state={menu} onClose={() => setMenu(null)} ariaLabel={`Actions for ${project.name}`}>
        <PopoverItem
          icon="ph:chat-circle-dots-bold"
          onSelect={() => {
            setMenu(null);
            onNewChat?.(project.root);
          }}
        >
          New session
        </PopoverItem>
        <PopoverItem
          icon={copied ? "ph:check" : "ph:copy"}
          onSelect={() => {
            setMenu(null);
            void copyRoot();
          }}
        >
          Copy path
        </PopoverItem>
        {hasDesktopBridge() ? (
          <PopoverItem
            icon="ph:folder-open-bold"
            onSelect={() => {
              setMenu(null);
              void revealProjectFolder(project.root);
            }}
          >
            Reveal in Finder
          </PopoverItem>
        ) : null}
      </ContextMenu>
    </li>
  );
}
