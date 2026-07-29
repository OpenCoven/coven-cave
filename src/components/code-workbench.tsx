"use client";

import { useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { useIsMobile } from "@/lib/use-viewport";
import { CodeComposer } from "@/components/code-composer";
import { CodeContextDock, type CodeContextTab } from "@/components/code-context-dock";
import { CodeTerminalWorkspace } from "@/components/code-terminal-workspace";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
} from "@/lib/code-surface";
import type { PendingCodeGithubOpen } from "@/lib/pending-code-github";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { SessionRow } from "@/lib/types";

export function CodeWorkbench({
  row,
  openTarget,
  pendingGithubOpen,
  initialContextTab,
  onJumpToSession,
  onFocusCard,
  onRefresh,
}: {
  row: SessionRow;
  openTarget?: PendingCodeOpen;
  pendingGithubOpen?: PendingCodeGithubOpen | null;
  initialContextTab?: CodeContextTab;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  onRefresh?: () => void;
}) {
  const [contextOpen, setContextOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [mobilePane, setMobilePane] = useState<"terminal" | "context">("terminal");
  const isMobile = useIsMobile();
  const contextPanelRef = usePanelRef();
  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const diffstat = codeSessionDiffstat(row);
  const pr = row.pullRequest;
  const running = codeSessionActivity(row) === "running";

  const toggleExpanded = () => {
    contextPanelRef.current?.resize(expanded ? "36%" : "56%");
    setExpanded((current) => !current);
  };

  const requestExpanded = () => {
    if (isMobile || expanded) return;
    contextPanelRef.current?.resize("56%");
    setExpanded(true);
  };

  useEffect(() => {
    if (openTarget || pendingGithubOpen) setMobilePane("context");
  }, [openTarget, pendingGithubOpen]);

  const terminalWorkspace = (
    <CodeTerminalWorkspace
      sessionId={row.id}
      projectRoot={workRoot}
      allowSplits={!isMobile}
    />
  );
  const contextDock = (
    <CodeContextDock
      row={row}
      workRoot={workRoot}
      running={running}
      openTarget={openTarget}
      pendingGithubOpen={pendingGithubOpen}
      initialTab={initialContextTab}
      expanded={expanded}
      resizable={!isMobile}
      onRequestExpand={requestExpanded}
      onToggleExpanded={toggleExpanded}
      onClose={() => {
        if (isMobile) setMobilePane("terminal");
        else setContextOpen(false);
        setExpanded(false);
      }}
      onJumpToSession={onJumpToSession}
      onFocusCard={onFocusCard}
      onRefresh={onRefresh}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-2" data-testid="code-workbench-header">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
              {row.title || row.id}
            </h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              {branch ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Icon name="ph:git-branch" width={10} height={10} />
                  <span className="min-w-0 truncate font-mono" title={branch}>
                    {branch}
                  </span>
                  {row.git?.isWorktree ? <span title={workRoot}>(worktree)</span> : null}
                </span>
              ) : null}
              {diffstat ? <span className="shrink-0 font-mono">{diffstat}</span> : null}
              {pr?.url ? (
                <a
                  className="focus-ring inline-flex shrink-0 items-center gap-1 underline decoration-dotted underline-offset-2"
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="ph:git-pull-request" width={10} height={10} />
                  {pr.number != null ? `#${pr.number}` : "PR"}
                  {pr.state ? ` (${pr.state})` : ""}
                </a>
              ) : null}
              <span className="shrink-0">Updated {relativeTime(row.updated_at)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!contextOpen ? (
              <IconButton
                icon="ph:sidebar-simple"
                size="sm"
                className="focus-ring"
                aria-label="Open context panel"
                title="Open context panel"
                onClick={() => {
                  setContextOpen(true);
                  setExpanded(false);
                }}
              />
            ) : null}
            <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
              Open in Chat
            </Button>
          </div>
        </div>
      </div>
      {isMobile ? (
        <div
          role="tablist"
          aria-label="Coding workspace pane"
          className="flex shrink-0 items-center gap-1 border-b border-[var(--border-hairline)] px-2 py-1"
        >
          {(["terminal", "context"] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              role="tab"
              aria-selected={mobilePane === pane}
              onClick={() => setMobilePane(pane)}
              className={`focus-ring rounded px-2 py-1 text-[length:var(--text-xs)] ${
                mobilePane === pane
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {pane === "terminal" ? "Terminal" : "Context"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {isMobile ? (
          mobilePane === "terminal" ? terminalWorkspace : contextDock
        ) : contextOpen ? (
          <Group className="h-full min-h-0 min-w-0" orientation="horizontal">
            <Panel id="code-terminal-center" defaultSize="64%" minSize="360px" className="min-h-0 min-w-0">
              {terminalWorkspace}
            </Panel>
            <Separator className="shell-separator">
              <SeparatorHandle orientation="col" />
            </Separator>
            <Panel
              id="code-context-dock"
              panelRef={contextPanelRef}
              defaultSize="36%"
              minSize="320px"
              maxSize="72%"
              className="min-h-0 min-w-0"
            >
              {contextDock}
            </Panel>
          </Group>
        ) : (
          terminalWorkspace
        )}
      </div>
      <CodeComposer row={row} onJumpToSession={onJumpToSession} />
    </div>
  );
}
