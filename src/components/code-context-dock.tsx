"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SessionChangesInner } from "@/components/session-changes-panel";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import type { Filter as GitHubFilter } from "@/components/github-view-data";
import type { PendingCodeGithubOpen } from "@/lib/pending-code-github";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { SessionRow } from "@/lib/types";

const LazyFiles = dynamic(
  () => import("@/components/code-workbench-files").then((module) => module.CodeWorkbenchFiles),
  { ssr: false },
);
const LazyPullRequest = dynamic(
  () => import("@/components/code-session-pr-panel").then((module) => module.CodeSessionPrPanel),
  { ssr: false },
);
const LazyInspector = dynamic(
  () => import("@/components/code-inspector").then((module) => module.CodeInspector),
  { ssr: false },
);
const LazyGitHub = dynamic(
  () => import("@/components/github-view").then((module) => module.GitHubView),
  { ssr: false },
);
const LazyBrowserPane = dynamic(
  () => import("@/components/browser-pane").then((module) => module.BrowserPane),
  { ssr: false },
);

export type CodeContextTab = "changes" | "files" | "pr" | "inspector" | "github" | "browser";

const TABS: Array<{
  id: CodeContextTab;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
}> = [
  { id: "changes", label: "Changes", icon: "ph:git-diff" },
  { id: "files", label: "Files", icon: "ph:folder-open" },
  { id: "pr", label: "Pull request", icon: "ph:git-pull-request" },
  { id: "inspector", label: "Inspector", icon: "ph:sliders-bold" },
  { id: "github", label: "GitHub", icon: "ph:github-logo" },
  { id: "browser", label: "Browser", icon: "ph:globe" },
];

const GITHUB_TAB_FILTER: Record<PendingCodeGithubOpen["tab"], GitHubFilter> = {
  prs: "pr",
  issues: "issue",
  reviews: "review_request",
};

export function CodeRoomGithub({
  pendingGithubOpen,
  onJumpToSession,
  onFocusCard,
  onRefresh,
}: {
  pendingGithubOpen: PendingCodeGithubOpen;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  onRefresh?: () => void;
}) {
  return (
    <LazyGitHub
      onJumpToSession={onJumpToSession}
      onFocusCard={onFocusCard}
      initialTarget={pendingGithubOpen.target}
      initialFilter={GITHUB_TAB_FILTER[pendingGithubOpen.tab]}
      onTasksRefresh={onRefresh}
    />
  );
}

export function CodeContextDock({
  row,
  workRoot,
  running,
  openTarget,
  pendingGithubOpen,
  initialTab,
  resizable = true,
  expanded,
  onRequestExpand,
  onToggleExpanded,
  onClose,
  onJumpToSession,
  onFocusCard,
  onRefresh,
}: {
  row: SessionRow;
  workRoot: string;
  running: boolean;
  openTarget?: PendingCodeOpen;
  pendingGithubOpen?: PendingCodeGithubOpen | null;
  initialTab?: CodeContextTab;
  resizable?: boolean;
  expanded: boolean;
  onRequestExpand: () => void;
  onToggleExpanded: () => void;
  onClose: () => void;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  onRefresh?: () => void;
}) {
  const [tab, setTab] = useState<CodeContextTab>(
    pendingGithubOpen
      ? "github"
      : openTarget
        ? openTarget?.kind === "changes" ? "changes" : "files"
        : initialTab ?? "changes",
  );

  useEffect(() => {
    if (!openTarget) return;
    setTab(openTarget?.kind === "changes" ? "changes" : "files");
  }, [openTarget]);

  useEffect(() => {
    if (!pendingGithubOpen) return;
    setTab("github");
  }, [pendingGithubOpen]);

  const selectTab = (next: CodeContextTab) => {
    setTab(next);
    if (next === "browser" && !expanded) onRequestExpand();
  };

  return (
    <section aria-label="Coding context" className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-base)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1">
        <div role="tablist" aria-label="Coding context" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              title={item.label}
              onClick={() => selectTab(item.id)}
              className={`focus-ring inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[length:var(--text-xs)] ${
                tab === item.id
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon name={item.icon} width={12} height={12} aria-hidden />
              <span className="hidden xl:inline">{item.label}</span>
            </button>
          ))}
        </div>
        {resizable ? (
          <IconButton
            icon="ph:sidebar-simple"
            size="sm"
            className="focus-ring"
            active={expanded}
            aria-label={expanded ? "Restore context panel width" : "Expand context panel"}
            title={expanded ? "Restore context panel width" : "Expand context panel"}
            onClick={onToggleExpanded}
          />
        ) : null}
        <IconButton
          icon="ph:x-bold"
          size="sm"
          className="focus-ring"
          aria-label="Close context panel"
          title="Close context panel"
          onClick={onClose}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "changes" ? (
          <SessionChangesInner
            key={workRoot}
            projectRoot={workRoot}
            running={running}
            focusPath={openTarget?.kind === "changes" ? openTarget.path : undefined}
            focusNonce={openTarget?.kind === "changes" ? openTarget.nonce : undefined}
          />
        ) : null}
        {tab === "files" ? (
          <LazyFiles
            key={workRoot}
            projectRoot={workRoot}
            familiarId={row.familiarId}
            focusPath={openTarget?.kind === "files" ? openTarget.path : undefined}
            focusNonce={openTarget?.kind === "files" ? openTarget.nonce : undefined}
          />
        ) : null}
        {tab === "pr" ? <LazyPullRequest key={row.id} row={row} /> : null}
        {tab === "inspector" ? <LazyInspector key={workRoot} row={row} onChanged={onRefresh} /> : null}
        {tab === "github" ? (
          <CodeRoomGithub
            pendingGithubOpen={pendingGithubOpen ?? { tab: "prs", nonce: 0 }}
            onJumpToSession={onJumpToSession}
            onFocusCard={onFocusCard}
            onRefresh={onRefresh}
          />
        ) : null}
        {tab === "browser" ? (
          <LazyBrowserPane
            label={`code-browser-${row.id}`}
            activeFamiliarId={row.familiarId}
            active={tab === "browser"}
          />
        ) : null}
      </div>
    </section>
  );
}
