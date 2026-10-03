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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { ProjectTree, type TreeDecoration } from "@/components/project-tree";
import type { ChangedFile, FileStatus } from "@/lib/session-changes-api";
import { HiddenUnicodeText } from "@/components/ui/hidden-unicode-text";
import { describeHiddenUnicode } from "@/lib/hidden-unicode";

/** Porcelain letters, matching what `git status --short` prints. Shared with
 *  the viewer's open-file tabs (#5705) so both print the same letter. */
export const STATUS_LETTER: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "C",
};

/** Join a repo-relative change path onto the root the tree renders absolute. */
export function absolutePath(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\.?\//, "")}`;
}

// Statuses that add or remove an entry in the tree; an edit in place does not.
const STRUCTURAL_STATUSES = new Set<FileStatus>(["added", "untracked", "deleted", "renamed"]);

/** Every folder from the file's parent up to `root`, inclusive. */
function ancestorDirs(root: string, absolute: string): string[] {
  const top = root.replace(/\/+$/, "");
  const dirs: string[] = [];
  for (let dir = absolute.slice(0, absolute.lastIndexOf("/")); dir.length >= top.length; dir = dir.slice(0, dir.lastIndexOf("/"))) {
    dirs.push(dir);
    if (dir === top || !dir.includes("/")) break;
  }
  return dirs;
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
  /** Whether the working-tree summary has loaded, and whether it succeeded.
   *  A failed request is not "0 changed" (#5729). */
  changesStatus?: "loading" | "ready" | "unavailable";
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
  changesStatus = "ready",
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

  // Files appearing or disappearing in the live list mean the tree's folders
  // changed (#5745): every folder above an entry that came or went is read
  // again. The first ready list counts too (#5753 review): the agent can add
  // or delete a file between the tree's load and that list, and no later poll
  // would ever differ from it.
  const structureKey = useMemo(
    () =>
      changes
        .filter((file) => STRUCTURAL_STATUSES.has(file.status))
        .flatMap((file) => (file.renamedFrom ? [file.path, file.renamedFrom] : [file.path]))
        .sort()
        .join("\n"),
    [changes],
  );
  const lastStructureRef = useRef<string | null>(null);
  const [refreshDirs, setRefreshDirs] = useState<{ dirs: ReadonlySet<string>; nonce: number } | null>(null);
  useEffect(() => {
    if (changesStatus !== "ready") return;
    const previous = lastStructureRef.current;
    lastStructureRef.current = structureKey;
    if (previous === structureKey) return;
    const before = new Set(previous ? previous.split("\n") : []);
    const after = new Set(structureKey ? structureKey.split("\n") : []);
    const moved = [...after].filter((path) => !before.has(path)).concat([...before].filter((path) => !after.has(path)));
    const dirs = new Set(moved.flatMap((path) => ancestorDirs(base, absolutePath(base, path))));
    if (dirs.size) setRefreshDirs((prev) => ({ dirs, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [base, changesStatus, structureKey]);

  const decorate = useCallback(
    (path: string) => byAbsolutePath.get(path) ?? null,
    [byAbsolutePath],
  );

  // A filter that hides everything reads as a broken tree, so the toggle is
  // only offered while there is something to filter down to.
  const changedCount = changes.length;
  const ready = changesStatus === "ready";
  const filtering = ready && changedOnly && changedCount > 0;

  return (
    <div className="code-tree" data-testid="code-workbench-tree">
      <div className="code-tree__head">
        <span className="code-tree__title">Files</span>
        <span className="code-tree__spacer" />
        <button
          type="button"
          className="focus-ring code-tree__filter"
          aria-pressed={filtering}
          disabled={!ready || changedCount === 0}
          title={
            changesStatus === "unavailable"
              ? "Couldn't load this worktree's changes"
              : !ready
                ? "Loading this worktree's changes"
                : changedCount === 0
                  ? "No working-tree changes to filter"
                  : filtering
                    ? "Show every file"
                    : "Show only files changed in this worktree"
          }
          onClick={() => onChangedOnlyChange(!changedOnly)}
        >
          <Icon name={changesStatus === "unavailable" ? "ph:warning-circle" : "ph:git-diff"} width={11} height={11} aria-hidden />
          {changesStatus === "unavailable"
            ? "Changes unavailable"
            : changesStatus === "loading"
              ? "Loading changes…"
              : `${changedCount} changed`}
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
                    <span className="code-tree__changed-path" title={describeHiddenUnicode(file.path)}>
                      <HiddenUnicodeText text={file.path} />
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
            refreshDirs={refreshDirs}
          />
        )}
      </div>
    </div>
  );
}
