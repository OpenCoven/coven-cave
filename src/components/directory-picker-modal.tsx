"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
type CreateFolderResponse = {
  ok: boolean;
  path?: string;
  error?: string;
};

function isCreateFolderResponse(value: unknown): value is CreateFolderResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as { ok?: unknown; path?: unknown; error?: unknown };
  return (
    typeof body.ok === "boolean" &&
    (typeof body.path === "string" || typeof body.path === "undefined") &&
    (typeof body.error === "string" || typeof body.error === "undefined")
  );
}

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
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const newFolderHintId = "directory-picker-new-folder-help";
  const newFolderErrorId = "directory-picker-new-folder-error";

  const resetCreateFolderState = useCallback(() => {
    setCreatingFolder(false);
    setNewFolderName("");
    setNewFolderError(null);
    setCreateBusy(false);
  }, []);

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
      resetCreateFolderState();
    }
  }, [open, load, resetCreateFolderState]);

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

  const beginCreatingFolder = () => {
    setCreatingFolder(true);
    setNewFolderError(null);
    requestAnimationFrame(() => newFolderInputRef.current?.focus());
  };

  const cancelCreatingFolder = () => {
    if (createBusy) return;
    resetCreateFolderState();
  };

  const createFolder = useCallback(async () => {
    if (!cwd || createBusy) return;
    setCreateBusy(true);
    setNewFolderError(null);
    try {
      const res = await fetch("/api/fs-browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ dir: cwd, name: newFolderName }),
      });
      const json = await res.json();
      const body = isCreateFolderResponse(json) ? json : null;
      if (!res.ok || !body?.ok || !body.path) {
        setNewFolderError(body?.error ?? "Could not create that folder");
        return;
      }
      resetCreateFolderState();
      await load(body.path);
    } catch {
      setNewFolderError("Could not reach the folder browser");
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, cwd, load, newFolderName, resetCreateFolderState]);

  const onCreateRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelCreatingFolder();
      return;
    }
    if (event.key === "Enter" && event.target === newFolderInputRef.current) {
      event.preventDefault();
      event.stopPropagation();
      if (!createBusy) void createFolder();
    }
  };

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
        className="flex h-[560px] w-[520px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] shadow-xl focus:outline-none"
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
            disabled={loading || createBusy || parent === null}
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
          <Button
            variant="secondary"
            size="xs"
            disabled={loading || createBusy || !cwd || creatingFolder}
            onClick={beginCreatingFolder}
            className="shrink-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
            leadingIcon="ph:folder-plus"
          >
            New folder
          </Button>
        </div>

        {creatingFolder ? (
          <div
            className="border-b border-[var(--border-hairline)] px-3 py-2"
            onKeyDown={onCreateRowKeyDown}
          >
            <label
              htmlFor="directory-picker-new-folder-name"
              className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]"
            >
              Folder name
            </label>
            <div className="flex items-center gap-2">
              <input
                id="directory-picker-new-folder-name"
                ref={newFolderInputRef}
                value={newFolderName}
                disabled={createBusy}
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                  setNewFolderError(null);
                }}
                placeholder="New folder"
                aria-invalid={Boolean(newFolderError)}
                aria-describedby={newFolderError ? `${newFolderHintId} ${newFolderErrorId}` : newFolderHintId}
                className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] disabled:opacity-60"
              />
              <Button
                variant="primary"
                size="sm"
                loading={createBusy}
                disabled={!newFolderName.trim()}
                onClick={() => void createFolder()}
                className="rounded-[var(--radius-control)] px-3 py-1 text-[12px] font-medium"
              >
                Create
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={createBusy}
                onClick={cancelCreatingFolder}
                className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </Button>
            </div>
            <p id={newFolderHintId} className="mt-1.5 text-[11px] text-[var(--text-muted)]">
              Create a subfolder in the folder you&apos;re browsing now.
            </p>
            {newFolderError ? (
              <p id={newFolderErrorId} role="alert" className="mt-1 text-[11px] text-[var(--color-danger,#e5484d)]">
                {newFolderError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {error ? (
            <p role="alert" className="px-2 py-4 text-[12px] text-[var(--color-danger,#e5484d)]">{error}</p>
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
                disabled={createBusy}
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
              disabled={!cwd || createBusy}
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
