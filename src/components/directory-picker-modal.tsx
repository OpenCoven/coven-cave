"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Button } from "@/components/ui/button";

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

  const dialogRef = useRef<HTMLDivElement | null>(null);
  // This is a true modal (aria-modal, covers the page). Trap focus inside it,
  // close on Escape, and restore focus to the trigger on close — the hook does
  // all three, replacing the old window-level Escape listener (which left focus
  // free to Tab out to the page behind the scrim).
  useFocusTrap(open, dialogRef, { onEscape: onClose });
  if (!open) return null;

  // Display the current path with $HOME collapsed to `~`.
  const display =
    cwd && home && (cwd === home || cwd.startsWith(home + "/"))
      ? "~" + cwd.slice(home.length)
      : cwd ?? "…";

  // Portal to <body>: this modal mounts inside arbitrary hosts (the home
  // composer card, the projects form), and a transformed/backdrop-filtered
  // ancestor there becomes the containing block for position:fixed — trapping
  // the scrim in that ancestor's stacking context, where sibling composer
  // chrome paints on top of the "open" modal. Rendering from <body> restores
  // true-viewport fixed positioning regardless of the host's styling.
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a project folder"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[80vh] w-[520px] max-w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] shadow-xl focus:outline-none"
        style={{ background: "var(--bg-panel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Choose a project folder</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] p-0 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            leadingIcon="ph:x"
          />
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
          <Button
            variant="secondary"
            size="xs"
            disabled={loading || parent === null}
            onClick={() => void load(parent)}
            aria-label="Up one folder"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[var(--border-hairline)] p-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40"
            leadingIcon="ph:arrow-up"
          />
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
              <Button
                key={e.path}
                variant="ghost"
                size="sm"
                onClick={() => void load(e.path)}
                className="w-full justify-start rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
                leadingIcon="ph:folder"
                trailingIcon="ph:caret-right"
              >
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
              </Button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">
            Select the folder you're browsing, or open a subfolder first.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!cwd}
              onClick={() => {
                if (cwd) onSelect(cwd);
              }}
              className="rounded-[var(--radius-control)] px-3 py-1 text-[12px] font-medium disabled:opacity-50"
            >
              Select this folder
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
