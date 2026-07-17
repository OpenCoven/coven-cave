"use client";

import "@/styles/cave-chat.css";

import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Icon } from "@/lib/icon";
import { ProjectTree } from "@/components/project-tree";
import { RailFilePreview } from "@/components/rail-file-preview";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { SeparatorHandle } from "@/components/ui/separator-handle";

/**
 * Files tab of the code rail: a scrollable project tree stacked over a
 * read-only preview of the selected file. Owns the `selectedPath` selection
 * and threads it into ProjectTree (controlled) and RailFilePreview.
 *
 * When the surface has no repo-linked project, renders a muted empty state.
 */
export function RailFilesPanel({
  projectRoot,
  familiarId,
  isFullscreen = false,
  focusPath,
  focusLine,
  focusNonce,
}: {
  projectRoot: string | null;
  familiarId?: string | null;
  isFullscreen?: boolean;
  focusPath?: string | null;
  focusLine?: number;
  focusNonce?: number;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // The fullscreen IDE split (tree / editor / diffs) persists across sessions —
  // same react-resizable-panels persistence the chat split uses.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workspace-rail-files-ide",
    panelIds: ["workspace-rail-files-tree", "workspace-rail-files-editor", "workspace-rail-files-diffs"],
  });

  // Open a path selected outside the tree (the preview's changed-file
  // launchpad hands back repo-relative paths) — resolve against the root the
  // same way focusPath events are.
  const openPath = useCallback(
    (path: string) => {
      setSelectedPath(
        path.startsWith("/")
          ? path
          : projectRoot
            ? `${projectRoot.replace(/\/$/, "")}/${path.replace(/^\.?\//, "")}`
            : path,
      );
    },
    [projectRoot],
  );

  // A new project resets the selection so a stale file from the previous repo
  // doesn't linger in the preview.
  useEffect(() => {
    setSelectedPath(null);
  }, [projectRoot]);

  useEffect(() => {
    if (!focusPath) return;
    const nextPath = focusPath.startsWith("/")
      ? focusPath
      : projectRoot
        ? `${projectRoot.replace(/\/$/, "")}/${focusPath.replace(/^\.?\//, "")}`
        : focusPath;
    setSelectedPath(nextPath);
  }, [focusLine, focusNonce, focusPath, projectRoot]);

  if (!projectRoot) {
    return (
      <div className="workspace-rail__files-empty">
        <Icon name="ph:folder-open" width={22} aria-hidden />
        <p>No project linked to this session.</p>
      </div>
    );
  }

  if (isFullscreen) {
    return (
      <div className="workspace-rail__files workspace-rail__files--ide">
        <Group
          className="workspace-rail__files-ide-group"
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel
            id="workspace-rail-files-tree"
            className="workspace-rail__files-tree-pane"
            defaultSize="280px"
            minSize="220px"
            maxSize="420px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="workspace-rail__files-tree workspace-rail__files-tree--ide">
              <ProjectTree
                root={projectRoot ?? undefined}
                familiarId={familiarId ?? undefined}
                selectedPath={selectedPath}
                onFileClick={setSelectedPath}
              />
            </div>
          </Panel>
          <Separator className="workspace-rail__files-separator shell-separator">
            <SeparatorHandle orientation="col" />
          </Separator>
          <Panel
            id="workspace-rail-files-editor"
            className="workspace-rail__files-editor"
            minSize="36%"
          >
            <div className="workspace-rail__files-preview workspace-rail__files-preview--ide">
              <RailFilePreview path={selectedPath} projectRoot={projectRoot} familiarId={familiarId} onOpenPath={openPath} />
            </div>
          </Panel>
          <Separator className="workspace-rail__files-separator shell-separator">
            <SeparatorHandle orientation="col" />
          </Separator>
          <Panel
            id="workspace-rail-files-diffs"
            className="workspace-rail__files-diffs"
            defaultSize="340px"
            minSize="280px"
            maxSize="520px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <SessionChangesPanel />
          </Panel>
        </Group>
      </div>
    );
  }

  return (
    <div className="workspace-rail__files">
      <div className="workspace-rail__files-tree">
        <ProjectTree
          root={projectRoot ?? undefined}
          familiarId={familiarId ?? undefined}
          selectedPath={selectedPath}
          onFileClick={setSelectedPath}
        />
      </div>
      <div className="workspace-rail__files-preview">
        <RailFilePreview path={selectedPath} projectRoot={projectRoot} familiarId={familiarId} onOpenPath={openPath} />
      </div>
    </div>
  );
}
