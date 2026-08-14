"use client";

/**
 * CodeWorkbenchTree — the Coding Desk's left column (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame gives the tree a job beyond browsing: it is
 * where you see what this session touched. Every file carries its working-tree
 * status, and a "N changed" toggle reduces the whole tree to just those files —
 * which is the view you actually want most of the time in a coding session,
 * and the one that previously required switching to a different tab.
 *
 * Status comes from the same `/api/changes` summary the review rail reads
 * (`useWorktreeChanges`), so the tree and the rail can never disagree about
 * what changed. The letter — M, A, D, R, ? — is always rendered, so "changed"
 * is never carried by colour alone.
 */

import { useCallback, useMemo } from "react";
import { Icon } from "@/lib/icon";
import { ProjectTree, type TreeDecoration } from "@/components/project-tree";
import type { ChangedFile, FileStatus } from "@/lib/session-changes-api";

/** Porcelain letters, matching what `git status --short` prints. */
const STATUS_LETTER: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

/** Join a repo-relative change path onto the root the tree renders absolute. */
function absolutePath(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\.?\//, "")}`;
}

export type CodeWorkbenchTreeProps = {
  projectRoot: string;
  familiarId?: string | null;
  selectedPath: string | null;
  onSelect: (absolutePath: string) => void;
  changes: ChangedFile[];
  /** Repo root the change paths are relative to; falls back to the work root. */
  repoRoot: string | null;
  changedOnly: boolean;
  onChangedOnlyChange: (next: boolean) => void;
};

export function CodeWorkbenchTree({
  projectRoot,
  familiarId,
  selectedPath,
  onSelect,
  changes,
  repoRoot,
  changedOnly,
  onChangedOnlyChange,
}: CodeWorkbenchTreeProps) {
  const base = repoRoot || projectRoot;

  const byAbsolutePath = useMemo(() => {
    const map = new Map<string, TreeDecoration>();
    for (const file of changes) {
      map.set(absolutePath(base, file.path), {
        status: STATUS_LETTER[file.status] ?? "M",
        additions: file.insertions ?? 0,
        deletions: file.deletions ?? 0,
      });
    }
    return map;
  }, [base, changes]);

  const decorate = useCallback(
    (path: string) => byAbsolutePath.get(path) ?? null,
    [byAbsolutePath],
  );

  // A filter that hides everything reads as a broken tree, so the toggle is
  // only offered while there is something to filter down to.
  const changedCount = changes.length;
  const filtering = changedOnly && changedCount > 0;

  return (
    <div className="code-tree" data-testid="code-workbench-tree">
      <div className="code-tree__head">
        <span className="code-tree__title">Files</span>
        <span className="code-tree__spacer" />
        <button
          type="button"
          className="focus-ring code-tree__filter"
          aria-pressed={filtering}
          disabled={changedCount === 0}
          title={
            changedCount === 0
              ? "No working-tree changes to filter"
              : filtering
                ? "Show every file"
                : "Show only files changed in this worktree"
          }
          onClick={() => onChangedOnlyChange(!changedOnly)}
        >
          <Icon name="ph:git-diff" width={11} height={11} aria-hidden />
          {changedCount} changed
        </button>
      </div>
      <div className="code-tree__body">
        {filtering ? (
          <ul className="code-tree__changed" aria-label="Changed files">
            {changes.map((file) => {
              const path = absolutePath(base, file.path);
              const selected = path === selectedPath;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    className="focus-ring code-tree__changed-row"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(path)}
                  >
                    <span className="code-tree__status-letter" data-status={STATUS_LETTER[file.status]}>
                      {STATUS_LETTER[file.status]}
                    </span>
                    <span className="code-tree__changed-path" title={file.path}>
                      {file.path}
                    </span>
                    {file.insertions ? (
                      <span className="code-tree__status-add">+{file.insertions}</span>
                    ) : null}
                    {file.deletions ? (
                      <span className="code-tree__status-del">&minus;{file.deletions}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ProjectTree
            root={projectRoot}
            familiarId={familiarId ?? undefined}
            decorate={decorate}
            selectedPath={selectedPath}
            onFileClick={onSelect}
          />
        )}
      </div>
    </div>
  );
}
