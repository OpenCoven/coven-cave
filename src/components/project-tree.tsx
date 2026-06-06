"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Icon } from "@/lib/icon";

type TreeEntry = {
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
  onFileClick?: (path: string) => void;
};

// Dirs that are collapsed by default (noise folders)
const COLLAPSED_BY_DEFAULT = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__pycache__",
  ".venv",
  "target",
  ".cargo",
]);

async function fetchTree(root: string, depth: number): Promise<TreeEntry[]> {
  try {
    const res = await fetch(
      `/api/project-tree?root=${encodeURIComponent(root)}&depth=${depth}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as {
      ok: boolean;
      entries?: TreeEntry[];
      error?: string;
    };
    if (json.ok && Array.isArray(json.entries)) return json.entries;
    return [];
  } catch {
    return [];
  }
}

function fileIconName(name: string): "ph:file-code" | "ph:file-image" | "ph:file-text" | "ph:file" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "rb", "java", "c", "cpp", "h", "swift", "kt", "sh", "bash", "zsh", "fish", "toml", "yaml", "yml", "json", "jsonc", "css", "scss", "html", "svelte", "vue", "astro", "mdx"].includes(ext)) return "ph:file-code";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "avif"].includes(ext)) return "ph:file-image";
  if (["md", "txt", "log", "env", "lock", "gitignore"].includes(ext)) return "ph:file-text";
  return "ph:file";
}

function resolveRoot(): string {
  if (typeof window !== "undefined") {
    const env = process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
    if (env) return env;
  }
  return "";
}

export const ProjectTree = forwardRef<ProjectTreeHandle, Props>(
  function ProjectTree({ root: rootProp, onFileClick }, ref) {
    const [root, setRoot] = useState<string>(resolveRoot);
    const [entries, setEntries] = useState<TreeEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
      setLoading(true);
      if (rootProp) {
        const tree = await fetchTree(rootProp, 1);
        setRoot(rootProp);
        setEntries(tree);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as Record<string, unknown>;
        const wp =
          (json.workspacePath as string | undefined) ??
          (json.projectRoot as string | undefined);
        if (wp && typeof wp === "string") {
          const tree = await fetchTree(wp, 1);
          setRoot(wp);
          setEntries(tree);
          setLoading(false);
          return;
        }
      } catch {
        /* use default */
      }
      if (!root) {
        setEntries([]);
        setLoading(false);
        return;
      }
      const tree = await fetchTree(root, 1);
      setEntries(tree);
      setLoading(false);
    }, [root, rootProp]);

    useEffect(() => {
      void load();
    }, [load]);

    useImperativeHandle(ref, () => ({ refresh: () => void load() }), [load]);

    if (loading) {
      return (
        <div className="flex items-center gap-2 py-2 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:arrow-clockwise" width={11} className="animate-spin" />
          Loading…
        </div>
      );
    }

    if (entries.length === 0) {
      return (
        <p className="py-2 text-[11px] text-[var(--text-muted)]">
          No files found.
        </p>
      );
    }

    return (
      <ul className="select-none space-y-px text-[11px]">
        {entries.map((e) => (
          <TreeNode key={e.path} entry={e} onFileClick={onFileClick} depth={0} />
        ))}
      </ul>
    );
  },
);

function TreeNode({
  entry,
  onFileClick,
  depth,
}: {
  entry: TreeEntry;
  onFileClick?: (path: string) => void;
  depth: number;
}) {
  const defaultExpanded = entry.isDir && !COLLAPSED_BY_DEFAULT.has(entry.name) && depth === 0;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [children, setChildren] = useState<TreeEntry[] | null>(
    entry.children ?? null,
  );
  const [loadingChildren, setLoadingChildren] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.isDir) {
      onFileClick?.(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoadingChildren(true);
      const fetched = await fetchTree(entry.path, 1);
      setChildren(fetched);
      setLoadingChildren(false);
    }
  }, [entry, expanded, children, onFileClick]);

  const paddingLeft = 6 + depth * 14;

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded py-[3px] text-left transition-colors hover:bg-[var(--bg-raised)]"
        style={{ paddingLeft, paddingRight: 6 }}
      >
        {/* Chevron for dirs, spacer for files */}
        <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--text-muted)]">
          {entry.isDir ? (
            loadingChildren ? (
              <Icon name="ph:arrow-clockwise" width={9} className="animate-spin" />
            ) : expanded ? (
              <Icon name="ph:caret-down" width={9} />
            ) : (
              <Icon name="ph:caret-right" width={9} />
            )
          ) : null}
        </span>

        {/* File/dir icon */}
        <span className="shrink-0 text-[var(--text-muted)]">
          {entry.isDir ? (
            expanded ? (
              <Icon name="ph:folder-open" width={13} />
            ) : (
              <Icon name="ph:folder" width={13} />
            )
          ) : (
            <Icon name={fileIconName(entry.name)} width={13} />
          )}
        </span>

        {/* Name */}
        <span
          className={`min-w-0 flex-1 truncate ${
            entry.isDir
              ? "font-medium text-[var(--text-secondary)]"
              : "text-[var(--text-primary)]"
          } ${COLLAPSED_BY_DEFAULT.has(entry.name) ? "opacity-50" : ""}`}
        >
          {entry.name}
        </span>
      </button>

      {entry.isDir && expanded && children && children.length > 0 && (
        <ul className="space-y-px">
          {children.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              onFileClick={onFileClick}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
