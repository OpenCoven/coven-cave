"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { RailFilesPanel } from "@/components/rail-files-panel";
import { RailTerminalPanel } from "@/components/rail-terminal-panel";
import type { CodeRailTab } from "@/lib/code-rail";
import type { PendingCodeRailOpen as CodeRailFocus } from "@/lib/pending-code-rail-open";

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
  focus,
  hidePin = false,
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
  focus?: CodeRailFocus | null;
  /** Hide the pin toggle (e.g. when hosted in a mobile sheet, where pinning a
   *  transient overlay open is meaningless). Defaults to false — desktop keeps
   *  the pin control. */
  hidePin?: boolean;
  onSelectTab: (tab: CodeRailTab) => void;
  onTogglePin: () => void;
  onCollapse: () => void;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Lazy pty: the terminal (and its shell) is not mounted until the Terminal tab
  // is first selected from the fullscreen rail. Once opened it stays mounted
  // (keepalive) while fullscreen but is hidden when another tab is active.
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  useEffect(() => {
    if (!isFullscreen && activeTab === "terminal") onSelectTab("files");
  }, [activeTab, isFullscreen, onSelectTab]);
  useEffect(() => {
    if (isFullscreen && activeTab === "terminal") setTerminalEverOpened(true);
  }, [activeTab, isFullscreen]);
  const terminalVisible = isFullscreen && activeTab === "terminal";
  const title = activeTab === "terminal" && !isFullscreen ? TAB_TITLE.files : TAB_TITLE[activeTab];

  return (
    <section
      className={`workspace-rail${isFullscreen ? " workspace-rail--fullscreen" : ""}`}
      aria-label="Code rail"
      data-fullscreen={isFullscreen ? "true" : undefined}
    >
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
        {isFullscreen && (
          <button
            type="button"
            aria-label="Terminal"
            aria-pressed={activeTab === "terminal"}
            className={`workspace-rail__tab focus-ring${activeTab === "terminal" ? " is-active" : ""}`}
            onClick={() => onSelectTab("terminal")}
          >
            <Icon name="ph:terminal-window" width={16} aria-hidden />
          </button>
        )}
      </nav>
      <div className="workspace-rail__body">
        {/* Progressive disclosure (§8): pin + fullscreen are occasional-use —
            they reveal on header hover / focus-within (and stay visible on
            touch); collapse remains the always-visible primary verb. */}
        <header className="workspace-rail__head reveal-scope">
          <span className="workspace-rail__title">{title}</span>
          <span className="workspace-rail__actions">
            {!hidePin && (
              <button
                type="button"
                className={`workspace-rail__btn focus-ring reveal-on-hover${pinned ? " is-on" : ""}`}
                aria-label={pinned ? "Unpin code rail" : "Pin code rail open"}
                aria-pressed={pinned}
                onClick={onTogglePin}
              >
                <Icon name={pinned ? "ph:push-pin-fill" : "ph:push-pin"} width={13} aria-hidden />
              </button>
            )}
            <button
              type="button"
              className={`workspace-rail__btn focus-ring reveal-on-hover${isFullscreen ? " is-on" : ""}`}
              aria-label={isFullscreen ? "Exit code rail fullscreen" : "Expand code rail fullscreen"}
              aria-pressed={isFullscreen}
              onClick={() => setIsFullscreen((value) => !value)}
            >
              <Icon name={isFullscreen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={13} aria-hidden />
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
          {/* Non-terminal panel body. Keyed by activeTab so React remounts it on
              a Changes<->Files switch and the CSS entrance animation replays
              (short crossfade). The terminal host below is deliberately OUTSIDE
              this keyed wrapper so its pty keepalive is never remounted. */}
          {activeTab !== "terminal" ? (
            <div className="workspace-rail__panel" key={activeTab}>
              {activeTab === "changes" ? (
                <SessionChangesPanel
                  focusPath={focus?.kind === "changes" ? focus.path : null}
                  focusNonce={focus?.kind === "changes" ? focus.nonce : undefined}
                />
              ) : (
                <RailFilesPanel
                  projectRoot={projectRoot}
                  familiarId={familiarId}
                  isFullscreen={isFullscreen}
                  focusPath={focus?.kind === "files" ? focus.path : null}
                  focusLine={focus?.kind === "files" ? focus.line : undefined}
                  focusNonce={focus?.kind === "files" ? focus.nonce : undefined}
                />
              )}
            </div>
          ) : null}
          {/* Terminal: mounted lazily on first selection, then kept mounted but
              visually hidden when another tab is active so the pty persists. */}
          {terminalEverOpened && isFullscreen ? (
            <div
              className={`workspace-rail__terminal workspace-rail__panel${terminalVisible ? "" : " is-hidden"}`}
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
