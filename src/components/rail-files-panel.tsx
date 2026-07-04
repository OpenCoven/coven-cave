"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { ProjectTree } from "@/components/project-tree";
import { RailFilePreview } from "@/components/rail-file-preview";

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
}: {
  projectRoot: string | null;
  familiarId?: string | null;
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
