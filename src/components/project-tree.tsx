"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "@/lib/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TreeEntry = {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeEntry[];
};

export type ProjectTreeHandle = {
  refresh: () => void;
};

type Props = {
  root?: string;
  /** Controlled selection — path of the currently open file */
  selectedPath?: string | null;
  onFileClick?: (path: string) => void;
  /**
   * When set, folder rows expose an "Add" affordance that picks the directory
   * (folder-picker mode). Clicking a folder name still expands it for browsing.
   */
  onDirSelect?: (path: string) => void;
  /** Paths already picked — folder-picker mode marks them as added. */
  selectedDirs?: Set<string>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Dirs that start collapsed (noise / generated output) */
const HIDDEN_BY_DEFAULT = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".cargo",
  ".gradle",
  ".idea",
  ".DS_Store",
]);

/** Sort: dirs before files, then alphabetical (dotfiles last within each group) */
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const aDot = a.name.startsWith(".");
    const bDot = b.name.startsWith(".");
    if (aDot !== bDot) return aDot ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// ─── File-type icon ───────────────────────────────────────────────────────────

type FileIcon =
  | "ph:file-code"
  | "ph:file-image"
  | "ph:file-text"
  | "ph:file";

function fileIcon(name: string): FileIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const code = [
    "ts","tsx","js","jsx","mjs","cjs","rs","py","go","rb","java",
    "c","cpp","h","swift","kt","sh","bash","zsh","fish",
    "toml","yaml","yml","json","jsonc","css","scss","html",
    "svelte","vue","astro","mdx","sql","graphql","gql",
  ];
  const img = ["png","jpg","jpeg","gif","svg","webp","ico","avif","bmp","tiff"];
  const text = ["md","txt","log","env","lock","gitignore","gitattributes","editorconfig","nvmrc"];
  if (code.includes(ext)) return "ph:file-code";
  if (img.includes(ext)) return "ph:file-image";
  if (text.includes(ext)) return "ph:file-text";
  return "ph:file";
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchChildren(dirPath: string): Promise<TreeEntry[]> {
  try {
    const res = await fetch(
      `/api/project-tree?root=${encodeURIComponent(dirPath)}&depth=1`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as {
      ok: boolean;
      entries?: TreeEntry[];
    };
    if (json.ok && Array.isArray(json.entries)) return sortEntries(json.entries);
    return [];
  } catch {
    return [];
  }
}

// ─── Root component ───────────────────────────────────────────────────────────

export const ProjectTree = forwardRef<ProjectTreeHandle, Props>(
  function ProjectTree({ root: rootProp, selectedPath, onFileClick, onDirSelect, selectedDirs }, ref) {
    const [root, setRoot] = useState<string>("");
    const [entries, setEntries] = useState<TreeEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => {
      mountedRef.current = true;
      return () => { mountedRef.current = false; };
    }, []);

    const load = useCallback(async (explicitRoot?: string) => {
      setLoading(true);
      const r = explicitRoot ?? rootProp;
      if (r) {
        const tree = await fetchChildren(r);
        if (!mountedRef.current) return;
        setRoot(r);
        setEntries(tree);
        setLoading(false);
        return;
      }
      setEntries([]);
      setLoading(false);
    }, [rootProp]);

    useEffect(() => { void load(); }, [load]);

    useImperativeHandle(ref, () => ({ refresh: () => void load() }), [load]);

    if (loading) {
      return (
        <div className="flex items-center gap-1.5 py-3 pl-1 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:arrow-clockwise" width={11} className="animate-spin shrink-0" />
          Loading…
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        <p className="py-3 pl-1 text-[11px] text-[var(--text-muted)]">
          No files found.
        </p>
      );
    }

    return (
      <div role="tree" className="select-none text-[12px] leading-none">
        {entries.map((e) => (
          <TreeRow
            key={e.path}
            entry={e}
            depth={0}
            root={root}
            selectedPath={selectedPath}
            onFileClick={onFileClick}
            onDirSelect={onDirSelect}
            selectedDirs={selectedDirs}
          />
        ))}
      </div>
    );
  },
);

// ─── TreeRow ──────────────────────────────────────────────────────────────────

function TreeRow({
  entry,
  depth,
  root,
  selectedPath,
  onFileClick,
  onDirSelect,
  selectedDirs,
}: {
  entry: TreeEntry;
  depth: number;
  root: string;
  selectedPath?: string | null;
  onFileClick?: (path: string) => void;
  onDirSelect?: (path: string) => void;
  selectedDirs?: Set<string>;
}) {
  const startsExpanded =
    entry.isDir && depth === 0 && !HIDDEN_BY_DEFAULT.has(entry.name);

  const [expanded, setExpanded] = useState(startsExpanded);
  const [children, setChildren] = useState<TreeEntry[] | null>(
    entry.children ? sortEntries(entry.children) : null,
  );
  const [fetching, setFetching] = useState(false);

  const isSelected = !entry.isDir && entry.path === selectedPath;
  const isHidden = HIDDEN_BY_DEFAULT.has(entry.name);
  const added = entry.isDir && (selectedDirs?.has(entry.path) ?? false);

  // Indent: 8px base + 16px per depth level; chevron takes 16px, icon takes 16px
  const indentPx = 4 + depth * 16;

  const handleClick = useCallback(async () => {
    if (!entry.isDir) {
      onFileClick?.(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setFetching(true);
      const fetched = await fetchChildren(entry.path);
      setChildren(fetched);
      setFetching(false);
    }
  }, [entry, expanded, children, onFileClick]);

  return (
    <div role="treeitem" aria-expanded={entry.isDir ? expanded : undefined}>
      {/* Row */}
      <button
        type="button"
        onClick={handleClick}
        className={`group flex w-full items-center gap-0 rounded-[5px] py-[3px] text-left transition-colors ${
          isSelected
            ? "bg-[var(--accent-presence)] text-white"
            : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
        } ${isHidden ? "opacity-40" : ""}`}
        style={{ paddingLeft: indentPx, paddingRight: 8, marginLeft: 4, marginRight: 4, width: "calc(100% - 8px)" }}
      >
        {/* Disclosure triangle — rotates via CSS */}
        <span
          className="flex h-[18px] w-[16px] shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {entry.isDir && (
            fetching ? (
              <Icon
                name="ph:arrow-clockwise"
                width={9}
                className="animate-spin text-[var(--text-muted)]"
              />
            ) : (
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                className="shrink-0 text-[var(--text-muted)] transition-transform duration-150"
                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                {/* Solid right-pointing triangle — mirrors macOS disclosure triangle */}
                <polygon points="1,1 7,4 1,7" fill="currentColor" />
              </svg>
            )
          )}
        </span>

        {/* Icon */}
        <span
          className={`flex h-[18px] w-[16px] shrink-0 items-center justify-center ${
            isSelected ? "text-white/80" : "text-[var(--text-muted)]"
          }`}
          aria-hidden="true"
        >
          {entry.isDir ? (
            expanded ? (
              <Icon name="ph:folder-open" width={13} />
            ) : (
              <Icon name="ph:folder" width={13} />
            )
          ) : (
            <Icon name={fileIcon(entry.name)} width={12} />
          )}
        </span>

        {/* Name */}
        <span
          className={`min-w-0 flex-1 truncate pl-1 ${
            entry.isDir ? "" : ""
          } ${isSelected ? "text-white" : ""}`}
        >
          {entry.name}
        </span>

        {/* Folder-picker affordance — pick this directory without leaving the
            tree. Uses role=button (not <button>) to avoid nesting inside the row
            button; stops propagation so it doesn't also toggle expand. */}
        {entry.isDir && onDirSelect ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={added ? `${entry.name} added as working directory` : `Use ${entry.name} as working directory`}
            onClick={(event) => { event.stopPropagation(); onDirSelect(entry.path); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onDirSelect(entry.path);
              }
            }}
            className={`ml-auto mr-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity ${
              added
                ? "text-[var(--accent-presence)]"
                : "text-[var(--text-muted)] opacity-0 hover:bg-[var(--bg-base)] group-hover:opacity-100"
            }`}
          >
            {added ? "Added" : "Use"}
          </span>
        ) : null}
      </button>

      {/* Children — no extra wrapper div, rows flow inline */}
      {entry.isDir && expanded && children && children.length > 0 &&
        children.map((c) => (
          <TreeRow
            key={c.path}
            entry={c}
            depth={depth + 1}
            root={root}
            selectedPath={selectedPath}
            onFileClick={onFileClick}
            onDirSelect={onDirSelect}
            selectedDirs={selectedDirs}
          />
        ))
      }
    </div>
  );
}
