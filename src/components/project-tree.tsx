"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
} from "react";
import { Icon } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { nextVisibleIndex, parentIndexByDepth } from "@/lib/tree-keynav";

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
  familiarId?: string;
  /** Controlled selection — path of the currently open file */
  selectedPath?: string | null;
  onFileClick?: (path: string) => void;
  /**
   * When set, folder rows expose an "Add" affordance that picks the directory
   * (folder-picker mode). Clicking a folder name still expands it for browsing.
   * Drag-and-drop move is disabled in this mode to avoid gesture conflicts.
   */
  onDirSelect?: (path: string) => void;
  /** Paths already picked — folder-picker mode marks them as added. */
  selectedDirs?: Set<string>;
};

/** Signals affected directories to refetch their children after a move. */
type RefetchSignal = { dirs: Set<string>; nonce: number };

/** MIME type carrying the dragged node's absolute path. */
const DRAG_MIME = "application/x-cave-tree-path";

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

/** Parent directory of an absolute path (no trailing slash). */
function parentDir(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? p : p.slice(0, idx);
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

/** Fetch a directory's immediate children. Returns the (sorted) entries, or
 *  null when the request fails — so callers can tell a load error apart from a
 *  genuinely empty directory and offer a retry. */
async function fetchChildren(dirPath: string, familiarId = ""): Promise<TreeEntry[] | null> {
  try {
    const params = new URLSearchParams({ root: dirPath, depth: "1", familiarId });
    const res = await fetch(
      `/api/project-tree?${params.toString()}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as {
      ok: boolean;
      entries?: TreeEntry[];
    };
    if (json.ok && Array.isArray(json.entries)) return sortEntries(json.entries);
    return null;
  } catch {
    return null;
  }
}

/** Move `from` into `toDir`. Returns null on success, else an error message. */
async function requestMove(from: string, toDir: string, familiarId = ""): Promise<string | null> {
  try {
    const res = await fetch("/api/project-tree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, toDir, familiarId }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    return json.ok ? null : json.error ?? "Move failed";
  } catch {
    return "Move failed";
  }
}

// ─── Root component ───────────────────────────────────────────────────────────

export const ProjectTree = forwardRef<ProjectTreeHandle, Props>(
  function ProjectTree({ root: rootProp, familiarId = "", selectedPath, onFileClick, onDirSelect, selectedDirs }, ref) {
    const [root, setRoot] = useState<string>("");
    const [entries, setEntries] = useState<TreeEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [refetchSignal, setRefetchSignal] = useState<RefetchSignal>({ dirs: new Set(), nonce: 0 });
    const [rootDrop, setRootDrop] = useState(false);
    const mountedRef = useRef(true);
    // The (root, familiar) we last fetched. A re-fetch of the SAME key is a
    // refresh: keep the existing tree mounted (TreeRows are keyed by path, so
    // their expansion state survives) instead of blanking to skeletons.
    const loadedKeyRef = useRef<string | null>(null);

    // Drag-and-drop move is enabled in browse mode (not folder-picker mode).
    const dndEnabled = onDirSelect == null;

    useEffect(() => {
      mountedRef.current = true;
      return () => { mountedRef.current = false; };
    }, []);

    const load = useCallback(async (explicitRoot?: string) => {
      const r = explicitRoot ?? rootProp;
      const key = `${r} ${familiarId}`;
      // Skeleton only on the first load or a project/familiar switch — a refresh
      // of the same tree refetches in place so expanded folders don't collapse.
      const isRefresh = loadedKeyRef.current === key;
      if (!isRefresh) setLoading(true);
      if (r) {
        const tree = await fetchChildren(r, familiarId);
        if (!mountedRef.current) return;
        setRoot(r);
        if (tree === null) {
          setLoadError(true);
          if (!isRefresh) setEntries([]); // keep a stale tree on a failed refresh
        } else {
          setLoadError(false);
          setEntries(tree);
        }
        loadedKeyRef.current = key;
        setLoading(false);
        return;
      }
      setEntries([]);
      setLoadError(false);
      loadedKeyRef.current = key;
      setLoading(false);
    }, [rootProp, familiarId]);

    useEffect(() => { void load(); }, [load]);

    useImperativeHandle(ref, () => ({ refresh: () => void load() }), [load]);

    const handleMove = useCallback(async (fromPath: string, toDirPath: string) => {
      if (!fromPath || !toDirPath || fromPath === toDirPath) return;
      // Already in the destination folder — nothing to do.
      if (parentDir(fromPath) === toDirPath) return;
      // Can't move a folder into itself or its own subtree.
      if (toDirPath === fromPath || toDirPath.startsWith(fromPath + "/")) {
        setMoveError("Can't move a folder into itself.");
        return;
      }
      const error = await requestMove(fromPath, toDirPath, familiarId);
      if (!mountedRef.current) return;
      if (error) {
        setMoveError(error);
        return;
      }
      setMoveError(null);
      // Refetch the source folder (item left) and destination (item arrived).
      const srcParent = parentDir(fromPath);
      setRefetchSignal((prev) => ({
        dirs: new Set([srcParent, toDirPath]),
        nonce: prev.nonce + 1,
      }));
      // Top-level changes aren't covered by row refetch — reload the root.
      if (srcParent === root || toDirPath === root) void load(root);
    }, [root, load, familiarId]);

    // Auto-dismiss the error banner.
    useEffect(() => {
      if (!moveError) return;
      const t = setTimeout(() => setMoveError(null), 4000);
      return () => clearTimeout(t);
    }, [moveError]);

    if (loading) {
      return (
        <div className="py-2 pl-1">
          <SkeletonRows count={6} />
        </div>
      );
    }
    if (entries.length === 0 && loadError) {
      return (
        <EmptyState
          compact
          icon="ph:warning-circle"
          headline="Couldn't load files"
          subtitle="The file tree failed to load."
          actions={
            <Button size="sm" variant="secondary" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      );
    }
    if (entries.length === 0) {
      return (
        <EmptyState
          compact
          icon="ph:folder-open"
          headline="No files found"
          subtitle="This project has no files, or they're all filtered out."
        />
      );
    }

    return (
      <>
        {moveError ? (
          <div
            role="alert"
            className="mx-1 mb-1 flex items-center gap-1.5 rounded-md bg-[var(--color-danger,#b91c1c)]/12 px-2 py-1 text-[11px] text-[var(--color-danger,#b91c1c)]"
          >
            <Icon name="ph:warning" width={12} className="shrink-0" />
            <span className="truncate">{moveError}</span>
          </div>
        ) : null}
        <div
          role="tree"
          className={`select-none rounded-md text-[12px] leading-none ${
            rootDrop ? "outline-dashed outline-1 outline-[var(--accent-presence)]" : ""
          }`}
          tabIndex={0}
          aria-label="File tree"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) return;
            const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tree-row]"));
            if (rows.length === 0) return;
            const i = rows.findIndex((r) => r === document.activeElement);
            if (i < 0) { e.preventDefault(); rows[0].focus(); return; }
            const row = rows[i];
            const item = row.closest('[role="treeitem"]');
            const isDir = item?.getAttribute("aria-expanded") != null;
            const expanded = item?.getAttribute("aria-expanded") === "true";
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
              const ni = nextVisibleIndex(e.key, i, rows.length);
              if (ni != null) { e.preventDefault(); rows[ni].focus(); }
              return;
            }
            if (e.key === "ArrowRight") {
              if (isDir && !expanded) { e.preventDefault(); row.click(); }
              else if (isDir && expanded && i + 1 < rows.length) { e.preventDefault(); rows[i + 1].focus(); }
              return;
            }
            if (e.key === "ArrowLeft") {
              if (isDir && expanded) { e.preventDefault(); row.click(); return; }
              const depths = rows.map((r) => Number(r.dataset.treeDepth ?? "0"));
              const p = parentIndexByDepth(depths, i);
              if (p != null) { e.preventDefault(); rows[p].focus(); }
              return;
            }
            e.preventDefault();
            row.click();
          }}
          onFocus={(e) => {
            if (e.target !== e.currentTarget) return;
            const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tree-row]"));
            if (rows.length === 0) return;
            (rows.find((r) => r.dataset.selected === "true") ?? rows[0]).focus();
          }}
          // Dropping on the tree background (not on a folder/file row) moves to root.
          onDragOver={dndEnabled ? (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setRootDrop(true);
          } : undefined}
          onDragLeave={dndEnabled ? () => setRootDrop(false) : undefined}
          onDrop={dndEnabled ? (e) => {
            e.preventDefault();
            setRootDrop(false);
            const src = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
            if (src && root) void handleMove(src, root);
          } : undefined}
        >
          {entries.map((e, i) => (
            <TreeRow
              key={e.path}
              entry={e}
              depth={0}
              index={i}
              siblingCount={entries.length}
              root={root}
              selectedPath={selectedPath}
              familiarId={familiarId}
              onFileClick={onFileClick}
              onDirSelect={onDirSelect}
              selectedDirs={selectedDirs}
              dndEnabled={dndEnabled}
              onMove={handleMove}
              refetchSignal={refetchSignal}
            />
          ))}
        </div>
      </>
    );
  },
);

// ─── TreeRow ──────────────────────────────────────────────────────────────────

function TreeRow({
  entry,
  depth,
  index,
  siblingCount,
  root,
  selectedPath,
  familiarId,
  onFileClick,
  onDirSelect,
  selectedDirs,
  dndEnabled,
  onMove,
  refetchSignal,
}: {
  entry: TreeEntry;
  depth: number;
  /** 0-based position among siblings — for aria-posinset. */
  index: number;
  /** Number of siblings at this level — for aria-setsize. */
  siblingCount: number;
  root: string;
  selectedPath?: string | null;
  familiarId?: string;
  onFileClick?: (path: string) => void;
  onDirSelect?: (path: string) => void;
  selectedDirs?: Set<string>;
  dndEnabled: boolean;
  onMove: (from: string, toDir: string) => void;
  refetchSignal: RefetchSignal;
}) {
  const startsExpanded =
    entry.isDir && depth === 0 && !HIDDEN_BY_DEFAULT.has(entry.name);

  const [expanded, setExpanded] = useState(startsExpanded);
  const [children, setChildren] = useState<TreeEntry[] | null>(
    entry.children ? sortEntries(entry.children) : null,
  );
  const [fetching, setFetching] = useState(false);
  // Set when a child fetch fails, so an expanded folder shows a retry instead
  // of looking empty.
  const [childError, setChildError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const isSelected = !entry.isDir && entry.path === selectedPath;
  const isHidden = HIDDEN_BY_DEFAULT.has(entry.name);
  const added = entry.isDir && (selectedDirs?.has(entry.path) ?? false);

  // Indent: 4px base + 16px per depth level; the chevron and icon take 16px each.
  const indentPx = 4 + depth * 16;

  const loadChildren = useCallback(async () => {
    setFetching(true);
    const fetched = await fetchChildren(entry.path, familiarId);
    setFetching(false);
    if (fetched === null) { setChildError(true); return; }
    setChildError(false);
    setChildren(fetched);
  }, [entry.path, familiarId]);

  const handleClick = useCallback(async () => {
    if (!entry.isDir) {
      onFileClick?.(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) await loadChildren();
  }, [entry.isDir, entry.path, expanded, children, onFileClick, loadChildren]);

  // Reveal-to-selection: when the selected (open) file lives somewhere under
  // this folder, auto-expand so the highlighted row becomes visible. This is
  // what makes "click a file in chat → open AND reveal it in the tree" work:
  // each ancestor expands (lazily fetching its children), and the next ancestor
  // mounts and repeats, cascading down to the file. We only ever expand here,
  // never collapse — a user's manual layout is preserved.
  const revealedRef = useRef(false);
  useEffect(() => {
    if (!entry.isDir || !selectedPath) return;
    if (selectedPath === entry.path || !selectedPath.startsWith(`${entry.path}/`)) return;
    setExpanded(true);
    if (children !== null || revealedRef.current) return;
    revealedRef.current = true;
    let alive = true;
    setFetching(true);
    void fetchChildren(entry.path, familiarId).then((fetched) => {
      if (!alive) return;
      setFetching(false);
      if (fetched === null) { setChildError(true); return; }
      setChildError(false);
      setChildren(fetched);
    });
    return () => { alive = false; };
  }, [selectedPath, entry.isDir, entry.path, children, familiarId]);

  // After a move, refetch this folder's children if it's affected and loaded.
  useEffect(() => {
    if (!entry.isDir || !refetchSignal.dirs.has(entry.path) || children === null) return;
    let cancelled = false;
    setFetching(true);
    void fetchChildren(entry.path, familiarId).then((fetched) => {
      if (cancelled) return;
      setFetching(false);
      if (fetched === null) { setChildError(true); return; }
      setChildError(false);
      setChildren(fetched);
    });
    return () => { cancelled = true; };
    // Re-run only when a new move signal arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchSignal]);

  return (
    <div
      role="treeitem"
      aria-expanded={entry.isDir ? expanded : undefined}
      aria-selected={isSelected || undefined}
      aria-level={depth + 1}
      aria-posinset={index + 1}
      aria-setsize={siblingCount}
    >
      {/* Row */}
      <button
        type="button"
        tabIndex={-1}
        data-tree-row=""
        data-tree-depth={depth}
        data-selected={isSelected ? "true" : undefined}
        onClick={handleClick}
        draggable={dndEnabled}
        onDragStart={dndEnabled ? (e) => {
          e.dataTransfer.setData(DRAG_MIME, entry.path);
          e.dataTransfer.setData("text/plain", entry.path);
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        } : undefined}
        onDragEnd={dndEnabled ? () => setDragging(false) : undefined}
        // Folders are drop targets (move into); files swallow the drag so the
        // tree-background "move to root" handler doesn't fire over them.
        onDragOver={dndEnabled ? (e) => {
          if (entry.isDir) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (!dropTarget) setDropTarget(true);
          } else {
            e.stopPropagation();
          }
        } : undefined}
        onDragLeave={dndEnabled && entry.isDir ? () => setDropTarget(false) : undefined}
        onDrop={dndEnabled ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(false);
          if (!entry.isDir) return;
          const src = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
          if (src && src !== entry.path) onMove(src, entry.path);
        } : undefined}
        className={`focus-ring-inset group flex w-full items-center gap-0 rounded-[5px] py-[3px] text-left transition-colors ${
          isSelected
            ? "bg-[var(--accent-presence)] text-white"
            : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
        } ${dropTarget ? "outline-dashed outline-1 outline-[var(--accent-presence)] bg-[var(--accent-presence)]/10" : ""} ${dragging ? "opacity-40" : ""} ${isHidden ? "opacity-40" : ""}`}
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
        <span className={`min-w-0 flex-1 truncate pl-1 ${isSelected ? "text-white" : ""}`}>
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
        children.map((c, i) => (
          <TreeRow
            key={c.path}
            entry={c}
            depth={depth + 1}
            index={i}
            siblingCount={children.length}
            root={root}
            selectedPath={selectedPath}
            familiarId={familiarId}
            onFileClick={onFileClick}
            onDirSelect={onDirSelect}
            selectedDirs={selectedDirs}
            dndEnabled={dndEnabled}
            onMove={onMove}
            refetchSignal={refetchSignal}
          />
        ))
      }

      {/* A child fetch failed — offer a retry instead of looking empty. */}
      {entry.isDir && expanded && childError && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void loadChildren(); }}
          className="flex items-center gap-1 py-[3px] text-[11px] text-[var(--color-danger,#b91c1c)] hover:underline"
          style={{ paddingLeft: 4 + (depth + 1) * 16 + 16 }}
        >
          <Icon name="ph:arrow-clockwise" width={10} className="shrink-0" />
          Couldn&apos;t load — retry
        </button>
      )}
    </div>
  );
}
