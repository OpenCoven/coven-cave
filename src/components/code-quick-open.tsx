"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterFileMentions } from "@/lib/file-mention";

/**
 * Quick-open file picker (⌘P) for the Code workspace. Fuzzy-jumps to any file
 * by name, reusing the cached workspace file index (`/api/project/files`, built
 * for the chat @-mention picker) and the same ranked fuzzy filter — so it never
 * needs the file tree. Selecting a file hands its repo-relative path back to the
 * caller, which opens it in the preview pane.
 */

const RESULT_LIMIT = 50;

export function CodeQuickOpen({
  open,
  root,
  onClose,
  onOpenFile,
}: {
  open: boolean;
  root: string | undefined;
  onClose: () => void;
  onOpenFile: (relPath: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Refresh the index each time the picker opens (the endpoint caches ~10s).
  useEffect(() => {
    if (!open || !root) return;
    setQuery("");
    setActiveIdx(0);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/project/files?root=${encodeURIComponent(root)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setFiles(Array.isArray(json.files) ? (json.files as string[]) : []);
        setTruncated(Boolean(json.truncated));
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, root]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => filterFileMentions(files, query, RESULT_LIMIT), [files, query]);
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const choose = (rel: string) => {
    onOpenFile(rel);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm"
      style={{ animation: "ui-modal-fade-in var(--duration-fast) var(--ease-decelerate)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Go to file"
        className="mt-[12vh] w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = results[activeIdx];
              if (r) choose(r);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Go to file…"
          aria-label="Go to file"
          className="focus-ring-inset w-full border-b border-[var(--border-hairline)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <ul role="listbox" aria-label="Files" className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              {root ? "No matching files." : "Open a project to search files."}
            </li>
          ) : (
            results.map((rel, i) => {
              const slash = rel.lastIndexOf("/");
              const dir = slash >= 0 ? rel.slice(0, slash + 1) : "";
              const base = slash >= 0 ? rel.slice(slash + 1) : rel;
              const active = i === activeIdx;
              return (
                <li key={rel} role="option" aria-selected={active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => choose(rel)}
                    className={`flex w-full items-baseline gap-2 border-l-2 px-4 py-1.5 text-left text-[13px] transition-colors ${
                      active
                        ? "border-l-[var(--accent-presence)] bg-[var(--bg-hover)]"
                        : "border-l-transparent hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span className="shrink-0 truncate text-[var(--text-primary)]">{base}</span>
                    <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]">{dir}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <span>↑↓ navigate · ⏎ open · esc close</span>
          {truncated ? <span>index capped at 5000 files</span> : null}
        </div>
      </div>
    </div>
  );
}
