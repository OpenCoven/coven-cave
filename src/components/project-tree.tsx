"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

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
  onFileClick?: (path: string) => void;
};

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

function resolveRoot(): string {
  if (typeof window !== "undefined") {
    const env = process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
    if (env) return env;
  }
  return "";
}

export const ProjectTree = forwardRef<ProjectTreeHandle, Props>(
  function ProjectTree({ onFileClick }, ref) {
    const [root, setRoot] = useState<string>(resolveRoot);
    const [entries, setEntries] = useState<TreeEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
      setLoading(true);
      // Try daemon status for projectRoot first
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as Record<string, unknown>;
        const wp =
          (json.workspacePath as string | undefined) ??
          (json.projectRoot as string | undefined);
        if (wp && typeof wp === "string") {
          const tree = await fetchTree(wp, 2);
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
      const tree = await fetchTree(root, 2);
      setEntries(tree);
      setLoading(false);
    }, [root]);

    useEffect(() => {
      void load();
    }, [load]);

    useImperativeHandle(ref, () => ({ refresh: () => void load() }), [load]);

    if (loading) {
      return (
        <p className="text-[var(--text-muted)]">Loading project tree...</p>
      );
    }

    if (entries.length === 0) {
      return <p className="text-[var(--text-muted)]">No entries found.</p>;
    }

    return (
      <ul className="space-y-0.5">
        {entries.map((e) => (
          <TreeNode key={e.path} entry={e} onFileClick={onFileClick} />
        ))}
      </ul>
    );
  },
);

function TreeNode({
  entry,
  onFileClick,
  depth = 0,
}: {
  entry: TreeEntry;
  onFileClick?: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(
    entry.children ?? null,
  );

  const toggle = useCallback(async () => {
    if (!entry.isDir) {
      onFileClick?.(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      const fetched = await fetchTree(entry.path, 1);
      setChildren(fetched);
    }
  }, [entry, expanded, children, onFileClick]);

  const indent = depth * 12;

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--bg-raised)]/60"
        style={{ paddingLeft: `${indent + 4}px` }}
      >
        {entry.isDir ? (
          <span className="w-3 shrink-0 text-center text-[var(--text-muted)]">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className={
            entry.isDir
              ? "text-[var(--text-secondary)] font-medium"
              : "text-[var(--text-primary)]"
          }
        >
          {entry.name}
        </span>
      </button>
      {entry.isDir && expanded && children && children.length > 0 && (
        <ul className="space-y-0.5">
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
