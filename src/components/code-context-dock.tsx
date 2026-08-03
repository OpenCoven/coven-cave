"use client";

/**
 * CodeContextDock — the Coding Room's right zone (cave-98o51).
 *
 * Changes, Files, Pull request, Inspector, GitHub context and Browser, docked
 * BESIDE the terminal center rather than replacing it. Every tab reuses its
 * proven implementation; the dock only owns which one is showing and how much
 * room it takes.
 *
 * Two behaviours worth knowing:
 *
 *  - heavy tabs stay dynamically imported, so opening the Room does not pull
 *    CodeMirror, the PR fetch hooks, or the browser bridge into the first chunk;
 *  - Browser opens the dock `expanded`, because a native webview squeezed into
 *    a sidebar renders a column of wrapped text. It also stays mounted once
 *    opened (hidden, not unmounted) so page state survives a tab switch, and
 *    is only `active` while actually selected — the native bounds follow the
 *    visible pane, never a hidden one.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { SessionChangesInner } from "@/components/session-changes-panel";
import { CODE_DOCK_TABS, codeSessionWorkRoot, type CodeDockSize, type CodeDockTab } from "@/lib/code-surface";
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
  browser: { label: "Browser", icon: "ph:globe" },
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
}: CodeContextDockProps) {
  const workRoot = codeSessionWorkRoot(row);
  // Browser keepalive: once opened, keep the pane mounted (hidden) so tabs and
  // scroll position survive a switch to Changes and back.
  const [browserOpened, setBrowserOpened] = useState(false);
  useEffect(() => {
    if (tab === "browser") setBrowserOpened(true);
  }, [tab]);

  const collapsed = size === "collapsed";
  const expanded = size === "expanded";

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
              aria-selected={!collapsed && tab === id}
              className="focus-ring code-context-dock__tab"
              data-selected={!collapsed && tab === id ? "true" : undefined}
              onClick={() => {
                onTabChange(id);
                // Picking a tab out of a collapsed dock has to reopen it, or
                // the click looks broken. Browser needs the room to render.
                if (id === "browser") onSizeChange("expanded");
                else if (collapsed) onSizeChange("normal");
              }}
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
            onClick={() => onSizeChange(expanded ? "normal" : "expanded")}
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
            aria-pressed={collapsed}
            title={collapsed ? "Show context" : "Collapse context"}
            onClick={() => onSizeChange(collapsed ? "normal" : "collapsed")}
          >
            <Icon name={collapsed ? "ph:caret-left" : "ph:caret-right"} width={12} height={12} />
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <div className="code-context-dock__body">
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
