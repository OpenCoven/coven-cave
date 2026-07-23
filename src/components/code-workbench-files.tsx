"use client";

/**
 * CodeWorkbenchFiles — the Code surface's Files tab (cave-k0ua): ProjectTree
 * beside the editable file preview. A thin side-by-side composition of the
 * chat rail's proven pieces — RailFilePreview already carries CodeMirror
 * editing with Cmd/Ctrl+S save through POST /api/project-file, so the
 * workbench adds layout, not behavior. Loaded via dynamic() from CodeView so
 * CodeMirror stays out of the surface's initial chunk.
 */

import React, { useCallback, useState } from "react";
import { ProjectTree } from "@/components/project-tree";
import { RailFilePreview } from "@/components/rail-file-preview";

export function CodeWorkbenchFiles({
  projectRoot,
  familiarId,
}: {
  projectRoot: string;
  familiarId?: string | null;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Repo-relative paths from the preview's changed-file launchpad resolve
  // against the workbench root (same contract as RailFilesPanel's focusPath).
  const openPath = useCallback(
    (path: string) => {
      const next = path.startsWith("/")
        ? path
        : `${projectRoot.replace(/\/$/, "")}/${path.replace(/^\.?\//, "")}`;
      setSelectedPath(next);
    },
    [projectRoot],
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--border-hairline)]">
        <ProjectTree
          root={projectRoot}
          familiarId={familiarId ?? undefined}
          selectedPath={selectedPath}
          onFileClick={setSelectedPath}
        />
      </div>
      <div className="min-w-0 flex-1">
        <RailFilePreview
          path={selectedPath}
          projectRoot={projectRoot}
          familiarId={familiarId}
          onOpenPath={openPath}
        />
      </div>
    </div>
  );
}
