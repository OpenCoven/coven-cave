"use client";

/**
 * review-file-navigator — the Review Deck's changed-file list.
 *
 * A column inside the change viewer that collapses to a spine when the pane is
 * narrow. Tree and flat modes render one flattened row list with listbox / tree
 * semantics, roving j/k traversal, and full paths kept intact: the strip it
 * replaced truncated paths and collapsed duplicate basenames onto each other,
 * so two files called `route.ts` were indistinguishable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import {
  buildNavRows,
  fileRowId,
  filterFiles,
  navigableFiles,
  nextNavPath,
  STATUS_GLYPH,
  type NavMode,
} from "./review-file-tree";
import type { ReviewFile } from "./use-review-source";

/** How many status dots the collapsed spine shows before it stops. */
const SPINE_DOTS = 12;

export function ReviewFileSpine({
  files,
  openPath,
  filtered,
  truncated,
  onExpand,
}: {
  files: readonly ReviewFile[];
  openPath: string | null;
  filtered: boolean;
  truncated: boolean;
  onExpand: () => void;
}) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const title = `Expand file navigator — ${files.length} files, +${additions} −${deletions}`;
  return (
    <button type="button" className="rd-nav-spine focus-ring-inset" title={title} aria-label={title} onClick={onExpand}>
      <span className="rd-nav-spine-head">
        <Icon name="ph:files" width={14} height={14} aria-hidden />
        <span className="rd-nav-spine-count">{files.length}</span>
      </span>
      <span className="rd-nav-spine-dots" aria-hidden>
        {files.slice(0, SPINE_DOTS).map((file) => (
          <span
            key={file.path}
            className="rd-nav-spine-dot"
            data-status={file.status}
            data-open={file.path === openPath ? "true" : undefined}
            data-hollow={file.noPatchReason != null ? "true" : undefined}
            title={`${file.path} (${file.status})`}
          />
        ))}
      </span>
      {truncated ? (
        <span className="rd-nav-spine-warn" aria-hidden>
          <Icon name="ph:warning-fill" width={11} height={11} />
        </span>
      ) : null}
      <span className="rd-nav-spine-label">{filtered ? "Filtered" : "Files"}</span>
      <span className="rd-nav-spine-caret" aria-hidden>
        <Icon name="ph:caret-right" width={11} height={11} />
      </span>
    </button>
  );
}

export function ReviewFileNavigator({
  files,
  filesShown,
  filesTotal,
  openPath,
  onOpen,
  onCollapse,
}: {
  files: readonly ReviewFile[];
  filesShown: number;
  filesTotal: number;
  openPath: string | null;
  onOpen: (path: string) => void;
  onCollapse: () => void;
}) {
  const [mode, setMode] = useState<NavMode>("flat");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [focused, setFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const visible = useMemo(() => filterFiles(files, query), [files, query]);
  const rows = useMemo(() => buildNavRows(visible, { mode, collapsedDirs }), [visible, mode, collapsedDirs]);
  const paths = useMemo(() => navigableFiles(rows), [rows]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const next = nextNavPath(paths, openPath, e.key);
      if (next == null) return;
      e.preventDefault();
      onOpen(next);
    },
    [paths, openPath, onOpen],
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const capped = filesShown < filesTotal;

  return (
    <div className="rd-nav">
      <div className="rd-nav-head">
        <div className="rd-nav-head-row">
          <span className="rd-nav-summary">
            {visible.length}
            {visible.length !== files.length ? ` of ${files.length}` : ""} files
          </span>
          <span className="rd-add">+{additions}</span>
          <span className="rd-del">−{deletions}</span>
          <span className="rd-spacer" />
          <button
            type="button"
            className="rd-nav-toggle focus-ring"
            data-active={searchOpen || query ? "true" : undefined}
            aria-expanded={searchOpen}
            aria-label="Filter changed files"
            title="Filter files"
            onClick={() => {
              setSearchOpen((open) => {
                if (open) setQuery("");
                return !open;
              });
            }}
          >
            <Icon name="ph:magnifying-glass" width={12} height={12} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-nav-toggle focus-ring"
            data-active={mode === "tree" ? "true" : undefined}
            aria-pressed={mode === "tree"}
            aria-label="Group files as a directory tree"
            title="Directory tree"
            onClick={() => setMode("tree")}
          >
            <Icon name="ph:tree-structure" width={12} height={12} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-nav-toggle focus-ring"
            data-active={mode === "flat" ? "true" : undefined}
            aria-pressed={mode === "flat"}
            aria-label="List files by folder"
            title="Flat list"
            onClick={() => setMode("flat")}
          >
            <Icon name="ph:rows" width={12} height={12} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-icon-btn focus-ring"
            aria-label="Collapse file navigator"
            title="Collapse files"
            onClick={onCollapse}
          >
            <Icon name="ph:sidebar-simple" width={12} height={12} aria-hidden />
          </button>
        </div>
        {searchOpen ? (
          <SearchInput
            ref={searchRef}
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            placeholder="Filter files…"
            aria-label="Filter changed files"
            containerClassName="rd-nav-search"
          />
        ) : null}
        {capped ? (
          <p
            className="rd-nav-trunc"
            role="status"
            title={`The diff route caps a response at ${filesShown} files. ${filesTotal - filesShown} changed files aren't listed here — open the pull request on GitHub for the full set.`}
          >
            <Icon name="ph:warning-fill" width={10} height={10} aria-hidden />
            <span>
              Showing {filesShown} of {filesTotal} files
            </span>
          </p>
        ) : null}
      </div>

      <div
        className="rd-nav-list rd-scroll"
        role={mode === "tree" ? "tree" : "listbox"}
        aria-label="Changed files"
        aria-activedescendant={openPath ? fileRowId(openPath) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {rows.map((row) => {
          if (row.kind === "group") {
            return (
              <div key={row.id} className="rd-nav-group" role="presentation" title={row.path}>
                {row.label}
              </div>
            );
          }
          if (row.kind === "dir") {
            return (
              <div
                key={row.id}
                id={row.id}
                className="rd-nav-dir"
                role="treeitem"
                aria-expanded={!row.collapsed}
                aria-level={row.level + 1}
                title={row.path}
                data-level={row.level}
                onClick={() => toggleDir(row.path)}
              >
                <span className="rd-nav-dir-caret" aria-hidden>
                  <Icon name={row.collapsed ? "ph:caret-right" : "ph:caret-down"} width={10} height={10} />
                </span>
                <span className="rd-nav-dir-name">{row.label}</span>
              </div>
            );
          }
          const open = row.path === openPath;
          return (
            <div
              key={row.id}
              id={row.id}
              className="rd-nav-file"
              role={mode === "tree" ? "treeitem" : "option"}
              aria-selected={open}
              aria-level={mode === "tree" ? row.level + 1 : undefined}
              data-open={open ? "true" : undefined}
              data-level={row.level}
              title={row.path}
              onClick={() => onOpen(row.path)}
            >
              <span className="rd-nav-glyph" data-status={row.file.status} aria-hidden>
                {STATUS_GLYPH[row.file.status]}
              </span>
              <span className="rd-nav-name">{row.name}</span>
              {row.parent ? (
                <span className="rd-nav-parent" data-duplicate={row.duplicate ? "true" : undefined}>
                  {row.parent}
                </span>
              ) : null}
              <span className="rd-spacer" />
              <span className="rd-nav-stat">
                +{row.file.additions} −{row.file.deletions}
              </span>
              {row.file.noPatchReason ? <span className="rd-nav-nopatch">no patch</span> : null}
            </div>
          );
        })}
      </div>

      {focused ? <p className="rd-nav-hint">↑↓ or j/k to move · enter to open</p> : null}
    </div>
  );
}
