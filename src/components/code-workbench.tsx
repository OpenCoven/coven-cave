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
 *   - PR → CodeSessionPrPanel (stage pipeline, checks, review threads,
 *     approve/merge via /api/github/*), dynamic() alongside its fetch hooks
 *
 * Right of the tabs (toggleable, md+ only): the inspector
 * (code-inspector.tsx) — session env, branch switcher, worktree creation.
 * Below the tabs (except Terminal, which owns its input): the follow-up
 * composer (code-composer.tsx) — sends to THIS session's agent.
 */

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import { SessionChangesInner } from "@/components/session-changes-panel";
import { CodeComposer } from "@/components/code-composer";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { SessionRow } from "@/lib/types";

const LazyFilesTab = dynamic(
  () => import("@/components/code-workbench-files").then((m) => m.CodeWorkbenchFiles),
  { ssr: false },
);
const LazyTerminalTab = dynamic(
  () => import("@/components/rail-terminal-panel").then((m) => m.RailTerminalPanel),
  { ssr: false },
);
const LazyPrTab = dynamic(
  () => import("@/components/code-session-pr-panel").then((m) => m.CodeSessionPrPanel),
  { ssr: false },
);
const LazyInspector = dynamic(
  () => import("@/components/code-inspector").then((m) => m.CodeInspector),
  { ssr: false },
);

const TAB_LABELS: Array<{ id: CodeWorkbenchTab; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "diff", label: "Diff", icon: "ph:git-diff" },
  { id: "files", label: "Files", icon: "ph:folder-open" },
  { id: "terminal", label: "Terminal", icon: "ph:terminal-window" },
  { id: "pr", label: "PR", icon: "ph:git-pull-request" },
];

export function CodeWorkbench({
  row,
  initialTab,
  openTarget,
  onJumpToSession,
  onRefresh,
}: {
  row: SessionRow;
  /** Deep-linked workbench tab (?wtab=). */
  initialTab?: CodeWorkbenchTab;
  /** A routed file/diff open (cave-ohcj): lands on the Files or Diff tab with
   *  that path focused. `nonce` re-triggers the jump for a repeated path. */
  openTarget?: PendingCodeOpen;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  /** Re-poll the enriched session list (branch/worktree chips) after inspector mutations. */
  onRefresh?: () => void;
}) {
  const [tab, setTab] = useState<CodeWorkbenchTab>(initialTab ?? "diff");
  // A routed open outranks the resting/deep-linked tab — a diff jump shows
  // the Diff tab, a file open the Files tab (also re-applied per nonce).
  useEffect(() => {
    if (!openTarget) return;
    setTab(openTarget.kind === "changes" ? "diff" : "files");
  }, [openTarget]);
  // Inspector (branches/worktrees/env) is an opt-in right column; md+ only —
  // the narrow-screen treatment lands with the mobile layout pass.
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
            <button
              type="button"
              aria-pressed={inspectorOpen}
              aria-label="Toggle inspector"
              title="Inspector — branches, worktrees, session env"
              onClick={() => setInspectorOpen((v) => !v)}
              className={`focus-ring hidden items-center gap-1.5 rounded px-2 py-1 text-[length:var(--text-xs)] md:inline-flex ${
                inspectorOpen
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon name="ph:sliders-bold" width={12} height={12} />
            </button>
            <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
              Open in Chat
            </Button>
          </div>
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
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {tab === "diff" ? (
            // Keyed by work root: the panel's file/diff/checkpoint state is
            // per-repo, and switching sessions must never show stale rows.
            <SessionChangesInner
              key={workRoot}
              projectRoot={workRoot}
              running={running}
              focusPath={openTarget?.kind === "changes" ? openTarget.path : undefined}
              focusNonce={openTarget?.kind === "changes" ? openTarget.nonce : undefined}
            />
          ) : null}
          {tab === "files" ? (
            <LazyFilesTab
              key={workRoot}
              projectRoot={workRoot}
              familiarId={row.familiarId}
              focusPath={openTarget?.kind === "files" ? openTarget.path : undefined}
              focusNonce={openTarget?.kind === "files" ? openTarget.nonce : undefined}
            />
          ) : null}
          {terminalOpened ? (
            <div className={tab === "terminal" ? "h-full min-h-0" : "hidden"}>
              <LazyTerminalTab sessionId={row.id} projectRoot={workRoot} active={tab === "terminal"} />
            </div>
          ) : null}
          {tab === "pr" ? <LazyPrTab key={row.id} row={row} /> : null}
        </div>
        {inspectorOpen ? (
          <aside
            aria-label="Session inspector"
            className="hidden w-72 shrink-0 border-l border-[var(--border-hairline)] md:block"
          >
            <LazyInspector key={workRoot} row={row} onChanged={onRefresh} />
          </aside>
        ) : null}
      </div>
      {tab !== "terminal" ? <CodeComposer row={row} onJumpToSession={onJumpToSession} /> : null}
    </div>
  );
}
