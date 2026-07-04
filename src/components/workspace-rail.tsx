"use client";
import { Icon } from "@/lib/icon";
import { SessionChangesPanel } from "@/components/session-changes-panel";
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
  onSelectTab,
  onTogglePin,
  onCollapse,
}: {
  changeCount: number;
  activeTab: CodeRailTab;
  pinned: boolean;
  onSelectTab: (tab: CodeRailTab) => void;
  onTogglePin: () => void;
  onCollapse: () => void;
}) {
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
          ) : (
            <p className="workspace-rail__soon">
              {TAB_TITLE[activeTab]} arrives in the next step.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
