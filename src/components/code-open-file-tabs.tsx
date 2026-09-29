"use client";

/**
 * CodeOpenFileTabs — the strip of opened files above the Coding Desk viewer
 * (#5705). Pure presentation over `code-open-files.ts`: the workbench owns
 * the list, this renders a WAI-ARIA tablist with roving focus and a close per
 * tab. A changed file carries the same porcelain letter the tree prints, so
 * the tint is never the only channel.
 */

import { useCallback, useRef, type KeyboardEvent } from "react";
import { Icon } from "@/lib/icon";
import { codeOpenFileLabels } from "@/lib/code-open-files";

export type CodeOpenFileTabsProps = {
  paths: readonly string[];
  active: string | null;
  /** Absolute path → porcelain status letter for files changed in the worktree. */
  status: ReadonlyMap<string, string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export function CodeOpenFileTabs({ paths, active, status, onSelect, onClose }: CodeOpenFileTabsProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, path: string) => {
      const index = paths.indexOf(path);
      if (index < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = (index + 1) % paths.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + paths.length) % paths.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = paths.length - 1;
      else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onClose(path);
        return;
      }
      if (next === null) return;
      event.preventDefault();
      const target = paths[next];
      onSelect(target);
      tabRefs.current.get(target)?.focus();
    },
    [onClose, onSelect, paths],
  );

  if (!paths.length) return null;
  const labels = codeOpenFileLabels(paths);

  return (
    <div className="code-tabs" role="tablist" aria-label="Open files" data-testid="code-open-file-tabs">
      {paths.map((path) => {
        const selected = path === active;
        const label = labels.get(path) ?? path;
        const letter = status.get(path) ?? null;
        return (
          <div key={path} className="code-tabs__item" data-selected={selected ? "true" : undefined}>
            <button
              type="button"
              role="tab"
              ref={(node) => {
                if (node) tabRefs.current.set(path, node);
                else tabRefs.current.delete(path);
              }}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className="focus-ring code-tabs__tab"
              title={path}
              onClick={() => onSelect(path)}
              onKeyDown={(event) => onKeyDown(event, path)}
            >
              <span className="code-tabs__label">{label}</span>
              {letter ? (
                <span className="code-tree__status-letter code-tabs__status" data-status={letter} title="Changed in this worktree">
                  {letter}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="focus-ring code-tabs__close"
              aria-label={`Close ${label}`}
              title={`Close ${label}`}
              onClick={() => onClose(path)}
            >
              <Icon name="ph:x" width={10} height={10} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
