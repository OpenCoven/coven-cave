"use client";

/**
 * CodeContextDock — the Coding Room's right zone (cave-98o51).
 *
 * Changes, Files, Pull request, Inspector, GitHub and Browser, docked
 * BESIDE the terminal center rather than replacing it. Every tab reuses its
 * proven implementation; the dock only owns which one is showing and how much
 * room it takes.
 *
 * Three behaviours worth knowing:
 *
 *  - heavy tabs stay dynamically imported, so opening the Room does not pull
 *    CodeMirror, the PR fetch hooks, GitHubView, or the browser bridge into the
 *    first chunk;
 *  - Browser and GitHub open the dock `expanded`, because a native webview — or
 *    a list/detail split — squeezed into a sidebar renders a column of wrapped
 *    text. Browser also stays mounted once opened (hidden, not unmounted) so
 *    page state survives a tab switch, and is only `active` while actually
 *    selected — the native bounds follow the visible pane, never a hidden one;
 *  - every tab and size change is announced (cave-uod42). The dock is the one
 *    zone whose content swaps under a stationary cursor, so without a live
 *    region a screen-reader user gets no signal that anything moved.
 *
 * Deliberate divergence from the approved design: it also said "there is no
 * top-level GitHub page". The top-level Activity/PRs/Issues/Reviews tabs are
 * shipped and e2e-pinned, and retiring a live surface is an IA call for the
 * owner, so this tab is additive — it puts GitHub context beside the terminal
 * without removing the full-width triage view.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { SessionChangesInner } from "@/components/session-changes-panel";
import {
  CODE_DOCK_TABS,
  codeDockTabWantsExpanded,
  codeSessionWorkRoot,
  type CodeDockSize,
  type CodeDockTab,
} from "@/lib/code-surface";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { SessionRow } from "@/lib/types";

const LazyFiles = dynamic(
  () => import("@/components/code-workbench-files").then((m) => m.CodeWorkbenchFiles),
  { ssr: false },
);
const LazyPr = dynamic(
  () => import("@/components/code-session-pr-panel").then((m) => m.CodeSessionPrPanel),
  { ssr: false },
);
const LazyInspector = dynamic(
  () => import("@/components/code-inspector").then((m) => m.CodeInspector),
  { ssr: false },
);
const LazyGitHub = dynamic(
  () => import("@/components/github-view").then((m) => m.GitHubView),
  { ssr: false },
);
const LazyBrowser = dynamic(
  () => import("@/components/browser-pane").then((m) => m.BrowserPane),
  { ssr: false },
);

const DOCK_TAB_META: Record<
  CodeDockTab,
  { label: string; icon: Parameters<typeof Icon>[0]["name"] }
> = {
  changes: { label: "Changes", icon: "ph:git-diff" },
  files: { label: "Files", icon: "ph:folder-open" },
  pr: { label: "Pull request", icon: "ph:git-pull-request" },
  inspector: { label: "Inspector", icon: "ph:sliders-bold" },
  github: { label: "GitHub", icon: "ph:github-logo" },
  browser: { label: "Browser", icon: "ph:globe" },
};

const DOCK_SIZE_ANNOUNCEMENT: Record<CodeDockSize, string> = {
  collapsed: "Session context collapsed.",
  normal: "Session context restored.",
  expanded: "Session context expanded.",
};

export type CodeContextDockProps = {
  row: SessionRow;
  tab: CodeDockTab;
  size: CodeDockSize;
  running: boolean;
  /** A routed file/diff open, already resolved to this session. */
  openTarget?: PendingCodeOpen;
  onTabChange: (tab: CodeDockTab) => void;
  onSizeChange: (size: CodeDockSize) => void;
  onRefresh?: () => void;
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
};

export function CodeContextDock({
  row,
  tab,
  size,
  running,
  openTarget,
  onTabChange,
  onSizeChange,
  onRefresh,
  onJumpToSession,
}: CodeContextDockProps) {
  const { announce } = useAnnouncer();
  const workRoot = codeSessionWorkRoot(row);
  // Browser keepalive: once opened, keep the pane mounted (hidden) so tabs and
  // scroll position survive a switch to Changes and back.
  const [browserOpened, setBrowserOpened] = useState(false);
  useEffect(() => {
    if (tab === "browser") setBrowserOpened(true);
  }, [tab]);

  const collapsed = size === "collapsed";
  const expanded = size === "expanded";

  const changeSize = useCallback(
    (next: CodeDockSize) => {
      if (next === size) return;
      onSizeChange(next);
      announce(DOCK_SIZE_ANNOUNCEMENT[next]);
    },
    [announce, onSizeChange, size],
  );

  const selectTab = useCallback(
    (next: CodeDockTab) => {
      // Picking a tab out of a collapsed dock has to reopen it, or the click
      // looks broken. Browser and GitHub need the room to render at all.
      const wantedSize: CodeDockSize | null = codeDockTabWantsExpanded(next)
        ? expanded
          ? null
          : "expanded"
        : collapsed
          ? "normal"
          : null;
      // Re-clicking the active tab when the dock is already sized for it changes
      // nothing — writing state again would only add live-region noise.
      if (next === tab && !wantedSize) return;
      onTabChange(next);
      if (wantedSize) changeSize(wantedSize);
      announce(`${DOCK_TAB_META[next].label} context shown.`);
    },
    [announce, changeSize, collapsed, expanded, onTabChange, tab],
  );

  return (
    <aside
      aria-label="Session context"
      data-testid="code-context-dock"
      data-size={size}
      className="code-context-dock"
    >
      <div className="code-context-dock__bar">
        <div role="tablist" aria-label="Session context" className="code-context-dock__tabs">
          {CODE_DOCK_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              // aria-selected tracks the active tab even while collapsed.
              // Forcing it false left the tablist with NO selected tab, so a
              // screen reader lost the current position entirely; "the panel
              // is hidden" is carried by the collapse control's aria-expanded,
              // which is the state that actually changed.
              aria-selected={tab === id}
              className="focus-ring code-context-dock__tab"
              data-selected={!collapsed && tab === id ? "true" : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon name={DOCK_TAB_META[id].icon} width={12} height={12} />
              <span className="code-context-dock__tab-label">{DOCK_TAB_META[id].label}</span>
            </button>
          ))}
        </div>
        <div className="code-context-dock__actions">
          <button
            type="button"
            className="focus-ring code-context-dock__action"
            aria-label={expanded ? "Restore context width" : "Expand context"}
            aria-pressed={expanded}
            title={expanded ? "Restore context width" : "Expand context"}
            onClick={() => changeSize(expanded ? "normal" : "expanded")}
          >
            <Icon
              name={expanded ? "ph:arrows-in-line-horizontal" : "ph:arrows-out-line-horizontal"}
              width={12}
              height={12}
            />
          </button>
          <button
            type="button"
            className="focus-ring code-context-dock__action"
            aria-label={collapsed ? "Show context" : "Collapse context"}
            // aria-expanded, not aria-pressed: this reveals and hides the dock
            // body, so it is a disclosure. It is also what now carries the
            // collapsed state, since the tabs keep their real selection.
            aria-expanded={!collapsed}
            aria-controls={`code-context-dock-body-${row.id}`}
            title={collapsed ? "Show context" : "Collapse context"}
            onClick={() => changeSize(collapsed ? "normal" : "collapsed")}
          >
            <Icon name={collapsed ? "ph:caret-left" : "ph:caret-right"} width={12} height={12} />
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <div className="code-context-dock__body" id={`code-context-dock-body-${row.id}`}>
          {tab === "changes" ? (
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
            <LazyFiles
              key={workRoot}
              projectRoot={workRoot}
              familiarId={row.familiarId}
              focusPath={openTarget?.kind === "files" ? openTarget.path : undefined}
              focusNonce={openTarget?.kind === "files" ? openTarget.nonce : undefined}
            />
          ) : null}
          {tab === "pr" ? <LazyPr key={row.id} row={row} /> : null}
          {tab === "inspector" ? <LazyInspector key={workRoot} row={row} onChanged={onRefresh} /> : null}
          {tab === "github" ? (
            // No `initialFilter`: unlike the top-level PRs/Issues/Reviews tabs,
            // the dock is not driving a slice, so the view keeps its own filter
            // control and the reader picks what they need beside the shell.
            <div className="code-context-dock__pane">
              <LazyGitHub onJumpToSession={onJumpToSession} onTasksRefresh={onRefresh} />
            </div>
          ) : null}
          {browserOpened ? (
            <div className={tab === "browser" ? "code-context-dock__pane" : "hidden"}>
              <LazyBrowser label={`code:${row.id}`} active={tab === "browser"} />
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
