"use client";

import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
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
}: {
  projectRoot: string | null;
  familiarId?: string | null;
  isFullscreen?: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // A new project resets the selection so a stale file from the previous repo
  // doesn't linger in the preview.
  useEffect(() => {
    setSelectedPath(null);
  }, [projectRoot]);

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
        <Group className="workspace-rail__files-ide-group" orientation="horizontal">
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
              <RailFilePreview path={selectedPath} projectRoot={projectRoot} familiarId={familiarId} />
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
        <RailFilePreview path={selectedPath} projectRoot={projectRoot} familiarId={familiarId} />
      </div>
    </div>
  );
}
