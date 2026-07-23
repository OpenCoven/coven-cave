"use client";

/**
 * CodeWorkbench — the Code surface's per-session center pane (cave-k0ua):
 * a compact session header (branch / PR / diffstat attribution chips + Open
 * in Chat) over Diff | Files | Terminal tabs.
 *
 * Reuse posture: each tab mounts a proven chat-rail piece scoped to the
 * session's *work root* (its worktree when it has one — never the shared
 * checkout, cave-9q24):
 *   - Diff → SessionChangesInner (status, unified diffs, commit, create-PR,
 *     checkpoints, per-file revert)
 *   - Files → CodeWorkbenchFiles (ProjectTree + editable RailFilePreview),
 *     dynamic() so CodeMirror stays out of the initial chunk
 *   - Terminal → RailTerminalPanel (per-session pty via cave.rail.<id>, so a
 *     shell started from Chat's rail is the SAME shell here), dynamic() for
 *     xterm; stays mounted once opened so scrollback survives tab switches
 *
 * The PR tab ("pr" in CODE_WORKBENCH_TABS) is deep-link-reserved but not
 * rendered yet — the stage-pipeline panel is the next PR in the series.
 */

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import { SessionChangesInner } from "@/components/session-changes-panel";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

const LazyFilesTab = dynamic(
  () => import("@/components/code-workbench-files").then((m) => m.CodeWorkbenchFiles),
  { ssr: false },
);
const LazyTerminalTab = dynamic(
  () => import("@/components/rail-terminal-panel").then((m) => m.RailTerminalPanel),
  { ssr: false },
);

const TAB_LABELS: Array<{ id: Exclude<CodeWorkbenchTab, "pr">; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "diff", label: "Diff", icon: "ph:git-diff" },
  { id: "files", label: "Files", icon: "ph:folder-open" },
  { id: "terminal", label: "Terminal", icon: "ph:terminal-window" },
];

export function CodeWorkbench({
  row,
  initialTab,
  onJumpToSession,
}: {
  row: SessionRow;
  /** Deep-linked workbench tab; "pr" coerces to "diff" until that tab lands. */
  initialTab?: CodeWorkbenchTab;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
}) {
  const [tab, setTab] = useState<Exclude<CodeWorkbenchTab, "pr">>(
    initialTab && initialTab !== "pr" ? initialTab : "diff",
  );
  // Terminal keepalive: once visited, keep the pty mounted (hidden) so the
  // shell and scrollback survive tab switches within the session.
  const [terminalOpened, setTerminalOpened] = useState(false);
  useEffect(() => {
    if (tab === "terminal") setTerminalOpened(true);
  }, [tab]);

  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const diffstat = codeSessionDiffstat(row);
  const pr = row.pullRequest;
  const running = codeSessionActivity(row) === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-2">
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
          <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
            Open in Chat
          </Button>
        </div>
        <div role="tablist" aria-label="Session workbench" className="mt-2 flex items-center gap-1">
          {TAB_LABELS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`focus-ring inline-flex items-center gap-1.5 rounded px-2 py-1 text-[length:var(--text-xs)] ${
                tab === t.id
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon name={t.icon} width={12} height={12} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "diff" ? (
          // Keyed by work root: the panel's file/diff/checkpoint state is
          // per-repo, and switching sessions must never show stale rows.
          <SessionChangesInner key={workRoot} projectRoot={workRoot} running={running} />
        ) : null}
        {tab === "files" ? (
          <LazyFilesTab key={workRoot} projectRoot={workRoot} familiarId={row.familiarId} />
        ) : null}
        {terminalOpened ? (
          <div className={tab === "terminal" ? "h-full min-h-0" : "hidden"}>
            <LazyTerminalTab sessionId={row.id} projectRoot={workRoot} active={tab === "terminal"} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
