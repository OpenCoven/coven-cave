"use client";

import { useState } from "react";

import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem } from "@/components/ui/popover";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import type { SessionRow } from "@/lib/types";
import { deriveProjectStatus } from "@/lib/project-status";
import { railRowMeta } from "@/lib/projects/detail-stats";

import {
  chatDotClass,
  hasDesktopBridge,
  lastActiveMs,
  revealProjectFolder,
} from "./projects-shared";

// The hub's master list, rendered inside the shared SurfaceRail: one row per
// project — avatar tile, name + relative time, a meta line (status dot +
// "N chats · branch"), and a trailing git indicator when the project's
// sessions carry git context. Collapsed rails show the avatar tiles only.
// Selecting a row swaps the detail pane; everything heavier (rename, path,
// sessions, remove) lives there. Rows are options in a listbox — the roving
// tabindex + type-ahead handlers in the shell move focus over
// [data-proj-nav]; Enter/Space/click select.

type ProjectListProps = {
  projects: CaveProject[];
  chatsByRoot: Map<string, SessionRow[]>;
  selectedId: string | null;
  /** False when the SurfaceRail is collapsed — rows shrink to avatar tiles. */
  railOpen?: boolean;
  onSelect: (id: string) => void;
  /** ArrowRight on a row: after selecting, hand focus into the detail pane. */
  onEnterDetail?: () => void;
  onNewChat?: (projectRoot: string) => void;
};

/** Latest session branch across a project's chats — real git context from
 *  /api/sessions/list; no fetches happen in the list pane. */
function latestSessionBranch(chats: SessionRow[]): string | null {
  let latest: SessionRow | null = null;
  for (const s of chats) {
    if (s.git?.branch && (!latest || s.updated_at > latest.updated_at)) latest = s;
  }
  return latest?.git?.branch ?? null;
}

export function ProjectList({ projects, chatsByRoot, selectedId, railOpen = true, onSelect, onEnterDetail, onNewChat }: ProjectListProps) {
  return (
    <ul role="listbox" aria-label="Projects" className="m-0 flex list-none flex-col gap-px p-0">
      {projects.map((project) => (
        <ProjectListRow
          key={project.id}
          project={project}
          chats={chatsByRoot.get(normalizeProjectRoot(project.root)) ?? []}
          selected={project.id === selectedId}
          railOpen={railOpen}
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
  railOpen,
  onSelect,
  onEnterDetail,
  onNewChat,
}: {
  project: CaveProject;
  chats: SessionRow[];
  selected: boolean;
  railOpen: boolean;
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
  const branch = latestSessionBranch(chats);
  const meta = railRowMeta(chats.length, branch);

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
        data-rail-open={railOpen ? undefined : "false"}
        id={`pcard-el:${normalizeProjectRoot(project.root)}`}
        aria-label={`${project.name}${statusLabel}`}
        title={railOpen ? project.root : project.name}
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
        <ProjectAvatar name={project.name} root={project.root} color={project.color} size={railOpen ? "lg" : "md"} />
        {railOpen ? (
          <>
            <span className="projects-list-row__body">
              <span className="projects-list-row__top">
                <span className="projects-list-row__name">{project.name}</span>
                <RelativeTime iso={lastIso} className="projects-list-row__time tabular-nums" />
              </span>
              <span className="projects-list-row__sub">
                {status ? (
                  <span
                    className={`projects-status-dot ${chatDotClass(status)}${status === "running" ? " animate-pulse" : ""}`}
                    role="img"
                    aria-label={`Latest chat ${status}`}
                    title={`Latest chat in this project: ${status}`}
                  />
                ) : null}
                {meta ? <span className="projects-list-row__meta">{meta}</span> : null}
              </span>
            </span>
            {branch ? (
              <span
                className="projects-list-row__git"
                title={`Branch: ${branch}`}
                role="img"
                aria-label={`On branch ${branch}`}
              >
                <Icon name="ph:git-branch" width={13} aria-hidden />
              </span>
            ) : null}
          </>
        ) : null}
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
