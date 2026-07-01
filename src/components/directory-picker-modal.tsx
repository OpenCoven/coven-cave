"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

type DirEntry = { name: string; path: string };
type BrowseResponse = {
  ok: boolean;
  home?: string;
  cwd?: string;
  parent?: string | null;
  entries?: DirEntry[];
  error?: string;
};

export type DirectoryPickerModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called with the absolute path of the chosen directory. */
  onSelect: (dir: string) => void;
};

/**
 * Web folder browser for the "New project" form. Navigates $HOME one level at a
 * time via GET /api/fs-browse (loopback-only, $HOME-rooted). The desktop build
 * uses the native OS dialog instead of this modal.
 */
export function DirectoryPickerModal({ open, onClose, onSelect }: DirectoryPickerModalProps) {
  const [home, setHome] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const url = dir ? `/api/fs-browse?dir=${encodeURIComponent(dir)}` : "/api/fs-browse";
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as BrowseResponse;
      if (!res.ok || !body.ok || !body.cwd) {
        setError(body.error ?? "Could not read that folder");
        return;
      }
      setHome((h) => h ?? body.home ?? body.cwd!);
      setCwd(body.cwd);
      setParent(body.parent ?? null);
      setEntries(body.entries ?? []);
    } catch {
      setError("Could not reach the folder browser");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load $HOME each time the modal opens; reset when it closes.
  useEffect(() => {
    if (open) void load(null);
    else {
      setCwd(null);
      setEntries([]);
      setError(null);
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  if (!open) return null;

  // Display the current path with $HOME collapsed to `~`.
  const display =
    cwd && home && (cwd === home || cwd.startsWith(home + "/"))
      ? "~" + cwd.slice(home.length)
      : cwd ?? "…";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a project folder"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[80vh] w-[520px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--border-hairline)] shadow-xl"
        style={{ background: "var(--bg-panel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Choose a project folder</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:x" width={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
          <button
            type="button"
            disabled={loading || parent === null}
            onClick={() => void load(parent)}
            aria-label="Up one folder"
            className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40"
          >
            <Icon name="ph:arrow-up" width={13} />
          </button>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text-secondary)]"
            title={cwd ?? undefined}
          >
            {display}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {error ? (
            <p className="px-2 py-4 text-[12px] text-[var(--color-danger,#e5484d)]">{error}</p>
          ) : loading && entries.length === 0 ? (
            <p className="px-2 py-4 text-[12px] text-[var(--text-muted)]">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-4 text-[12px] text-[var(--text-muted)]">No subfolders here.</p>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => void load(e.path)}
                className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
              >
                <Icon name="ph:folder" width={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <Icon name="ph:caret-right" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">
            Select the folder you're browsing, or open a subfolder first.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!cwd}
              onClick={() => {
                if (cwd) onSelect(cwd);
              }}
              className="focus-ring rounded-md px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50"
              style={{ background: "var(--accent-presence)" }}
            >
              Select this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
