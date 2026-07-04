"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { RailFilesPanel } from "@/components/rail-files-panel";
import { RailTerminalPanel } from "@/components/rail-terminal-panel";
import type { CodeRailTab } from "@/lib/code-rail";

const TAB_TITLE: Record<CodeRailTab, string> = {
  changes: "Changes",
  files: "Files",
  terminal: "Terminal",
};

export function WorkspaceRail({
  changeCount,
  activeTab,
  pinned,
  projectRoot,
  familiarId,
  sessionId,
  onSelectTab,
  onTogglePin,
  onCollapse,
}: {
  changeCount: number;
  activeTab: CodeRailTab;
  pinned: boolean;
  projectRoot: string | null;
  familiarId?: string | null;
  sessionId: string | null;
  onSelectTab: (tab: CodeRailTab) => void;
  onTogglePin: () => void;
  onCollapse: () => void;
}) {
  // Lazy pty: the terminal (and its shell) is not mounted until the Terminal tab
  // is first selected. Once opened it stays mounted (keepalive) but is hidden
  // when another tab is active, so the pty survives tab switches.
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  useEffect(() => {
    if (activeTab === "terminal") setTerminalEverOpened(true);
  }, [activeTab]);
  const terminalVisible = activeTab === "terminal";

  return (
    <section className="workspace-rail" aria-label="Code rail">
      <nav className="workspace-rail__strip" aria-label="Code rail tabs">
        <button
          type="button"
          aria-label="Changes"
          aria-pressed={activeTab === "changes"}
          className={`workspace-rail__tab focus-ring${activeTab === "changes" ? " is-active" : ""}`}
          onClick={() => onSelectTab("changes")}
        >
          <Icon name="ph:git-diff" width={16} aria-hidden />
          {changeCount > 0 ? <span className="workspace-rail__badge">{changeCount}</span> : null}
        </button>
        <button
          type="button"
          aria-label="Files"
          aria-pressed={activeTab === "files"}
          className={`workspace-rail__tab focus-ring${activeTab === "files" ? " is-active" : ""}`}
          onClick={() => onSelectTab("files")}
        >
          <Icon name="ph:folder" width={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Terminal"
          aria-pressed={activeTab === "terminal"}
          className={`workspace-rail__tab focus-ring${activeTab === "terminal" ? " is-active" : ""}`}
          onClick={() => onSelectTab("terminal")}
        >
          <Icon name="ph:terminal-window" width={16} aria-hidden />
        </button>
      </nav>
      <div className="workspace-rail__body">
        <header className="workspace-rail__head">
          <span className="workspace-rail__title">{TAB_TITLE[activeTab]}</span>
          <span className="workspace-rail__actions">
            <button
              type="button"
              className={`workspace-rail__btn focus-ring${pinned ? " is-on" : ""}`}
              aria-label={pinned ? "Unpin code rail" : "Pin code rail open"}
              aria-pressed={pinned}
              onClick={onTogglePin}
            >
              <Icon name={pinned ? "ph:push-pin-fill" : "ph:push-pin"} width={13} aria-hidden />
            </button>
            <button
              type="button"
              className="workspace-rail__btn focus-ring"
              aria-label="Collapse code rail"
              onClick={onCollapse}
            >
              <Icon name="ph:caret-right" width={13} aria-hidden />
            </button>
          </span>
        </header>
        <div className="workspace-rail__pane">
          {activeTab === "changes" ? (
            <SessionChangesPanel />
          ) : activeTab === "files" ? (
            <RailFilesPanel projectRoot={projectRoot} familiarId={familiarId} />
          ) : null}
          {/* Terminal: mounted lazily on first selection, then kept mounted but
              visually hidden when another tab is active so the pty persists. */}
          {terminalEverOpened ? (
            <div
              className={`workspace-rail__terminal${terminalVisible ? "" : " is-hidden"}`}
              hidden={!terminalVisible}
            >
              <RailTerminalPanel
                sessionId={sessionId}
                projectRoot={projectRoot}
                active={terminalVisible}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
