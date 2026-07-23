"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";

type DirEntry = { name: string; path: string; workspace?: boolean };
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

/** "Select Documents", truncated so long folder names can't blow out the footer. */
function truncateName(name: string): string {
  return name.length > 22 ? name.slice(0, 21) + "…" : name;
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
 *
 * Interaction model (project-folder-modal redesign): clicking a row selects it
 * without entering; the trailing chevron (or double-click) opens it. The footer
 * echoes the pending path and the primary action names the folder it will
 * select — the current folder when nothing is highlighted. $HOME itself is
 * never selectable (registering the whole home directory is always a mistake),
 * matching isAllowedNewProjectRoot on the server.
 */
export function DirectoryPickerModal({ open, onClose, onSelect }: DirectoryPickerModalProps) {
  const [home, setHome] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const newFolderTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const modalSessionRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const newFolderHintId = "directory-picker-new-folder-help";
  const newFolderErrorId = "directory-picker-new-folder-error";

  const resetCreateFolderState = useCallback(({ preserveBusy = false }: { preserveBusy?: boolean } = {}) => {
    setCreatingFolder(false);
    setNewFolderName("");
    setNewFolderError(null);
    if (!preserveBusy) setCreateBusy(false);
  }, []);

  const load = useCallback(async (dir: string | null, sessionGeneration = modalSessionRef.current) => {
    if (sessionGeneration !== modalSessionRef.current) return;
    const loadGeneration = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const url = dir ? `/api/fs-browse?dir=${encodeURIComponent(dir)}` : "/api/fs-browse";
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as BrowseResponse;
      if (sessionGeneration !== modalSessionRef.current || loadGeneration !== loadGenerationRef.current) return;
      if (!res.ok || !body.ok || !body.cwd) {
        setError(body.error ?? "Could not read that folder");
        return;
      }
      setHome((h) => h ?? body.home ?? body.cwd!);
      setCwd(body.cwd);
      setParent(body.parent ?? null);
      setEntries(body.entries ?? []);
    } catch {
      if (sessionGeneration !== modalSessionRef.current || loadGeneration !== loadGenerationRef.current) return;
      setError("Could not reach the folder browser");
    } finally {
      if (sessionGeneration !== modalSessionRef.current || loadGeneration !== loadGenerationRef.current) return;
      setLoading(false);
    }
  }, []);

  // Navigation (up, crumbs, opening a row) clears the per-folder UI state —
  // filter, highlight, and any in-progress inline create — before loading.
  const navigateTo = useCallback(
    (dir: string | null) => {
      setFilter("");
      setSelectedPath(null);
      resetCreateFolderState();
      void load(dir);
    },
    [load, resetCreateFolderState],
  );

  // Load $HOME each time the modal opens; reset when it closes.
  useEffect(() => {
    modalSessionRef.current += 1;
    const sessionGeneration = modalSessionRef.current;
    if (open) void load(null, sessionGeneration);
    else {
      loadGenerationRef.current += 1;
      setHome(null);
      setCwd(null);
      setParent(null);
      setEntries([]);
      setLoading(false);
      setError(null);
      setFilter("");
      setSelectedPath(null);
      resetCreateFolderState();
    }
  }, [open, load, resetCreateFolderState]);

  // This is a true modal (aria-modal, covers the page). Trap focus inside it,
  // close on Escape, and restore focus to the trigger on close — the hook does
  // all three, replacing the old window-level Escape listener (which left focus
  // free to Tab out to the page behind the scrim).
  useFocusTrap(open, dialogRef, { onEscape: onClose });

  const beginCreatingFolder = () => {
    setCreatingFolder(true);
    setNewFolderError(null);
    requestAnimationFrame(() => newFolderInputRef.current?.focus({ preventScroll: true }));
  };

  const cancelCreatingFolder = () => {
    if (createBusy) return;
    resetCreateFolderState();
    requestAnimationFrame(() => newFolderTriggerRef.current?.focus({ preventScroll: true }));
  };

  const createFolder = useCallback(async () => {
    if (!cwd || createBusy) return;
    const sessionGeneration = modalSessionRef.current;
    let shouldRefocusInput = false;
    let shouldRefocusCloseButton = false;
    closeButtonRef.current?.focus({ preventScroll: true });
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
      if (sessionGeneration !== modalSessionRef.current) return;
      if (!res.ok || !body?.ok || !body.path) {
        shouldRefocusInput = true;
        setNewFolderError(body?.error ?? "Could not create that folder");
        return;
      }
      resetCreateFolderState({ preserveBusy: true });
      // Stay in the current folder and highlight the new one, so the footer's
      // "Select <name>" finishes the flow in one click (the old modal jumped
      // inside the empty folder instead).
      setFilter("");
      await load(cwd, sessionGeneration);
      if (sessionGeneration === modalSessionRef.current) {
        setSelectedPath(body.path);
        shouldRefocusCloseButton = true;
      }
    } catch {
      if (sessionGeneration !== modalSessionRef.current) return;
      shouldRefocusInput = true;
      setNewFolderError("Could not reach the folder browser");
    } finally {
      if (sessionGeneration !== modalSessionRef.current) return;
      setCreateBusy(false);
      if (shouldRefocusCloseButton) {
        requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
      }
      if (shouldRefocusInput) {
        requestAnimationFrame(() => newFolderInputRef.current?.focus({ preventScroll: true }));
      }
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

  // Breadcrumb trail from ~ down to the current folder. The API is
  // $HOME-rooted, so cwd is always at or under home once loaded.
  const crumbs = useMemo(() => {
    if (!cwd || !home) return [];
    const trail: Array<{ name: string; path: string }> = [{ name: "~", path: home }];
    if (cwd !== home && cwd.startsWith(home + "/")) {
      let acc = home;
      for (const segment of cwd.slice(home.length).split("/").filter(Boolean)) {
        acc = acc + "/" + segment;
        trail.push({ name: segment, path: acc });
      }
    }
    return trail;
  }, [cwd, home]);

  if (!open) return null;

  const collapseHome = (value: string) =>
    home && (value === home || value.startsWith(home + "/")) ? "~" + value.slice(home.length) : value;

  const query = filter.trim().toLowerCase();
  const visibleEntries = query ? entries.filter((e) => e.name.toLowerCase().includes(query)) : entries;
  const selected = selectedPath ? entries.find((e) => e.path === selectedPath) ?? null : null;

  const atHomeRoot = cwd !== null && cwd === home;
  const pendingPath = selected?.path ?? cwd;
  const pendingName = selected ? selected.name : atHomeRoot ? null : cwd ? cwd.slice(cwd.lastIndexOf("/") + 1) : null;
  const selectLabel = pendingName ? `Select ${truncateName(pendingName)}` : "Select home";
  // $HOME itself is never a valid project root (isAllowedNewProjectRoot
  // excludes it), so bare-home selection stays disabled until the user
  // highlights or enters a subfolder.
  const selectDisabled = !cwd || createBusy || (!selected && atHomeRoot);

  // Portal to <body>: this modal mounts inside arbitrary hosts (the home
  // composer card, the projects form), and a transformed/backdrop-filtered
  // ancestor there becomes the containing block for position:fixed — trapping
  // the scrim in that ancestor's stacking context, where sibling composer
  // chrome paints on top of the "open" modal. Rendering from <body> restores
  // true-viewport fixed positioning regardless of the host's styling.
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6 [background:color-mix(in_oklch,var(--bg-panel)_62%,transparent)] backdrop-blur-[6px] [animation:ui-modal-fade-in_var(--duration-fast)_var(--ease-decelerate)] motion-reduce:[animation:none]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a project folder"
        tabIndex={-1}
        className="flex w-[560px] max-w-full max-h-[min(680px,92dvh)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] shadow-[0_30px_70px_-18px_oklch(0_0_0/70%),0_0_0_1px_color-mix(in_oklch,var(--foreground)_4%,transparent)] [animation:ui-modal-enter_var(--duration-base)_var(--ease-decelerate)] motion-reduce:[animation:none] focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 pb-4 pt-[18px]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[length:var(--text-md)] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Choose a project folder
            </span>
            <span className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Pick where this project&apos;s chats will live.
            </span>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            className="h-[30px] w-[30px] flex-none rounded-[var(--radius-control)] p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:x" width={16} aria-hidden />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 px-3.5 pb-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || createBusy || parent === null}
            onClick={() => navigateTo(parent)}
            aria-label="Up one folder"
            className="h-[30px] w-[30px] flex-none rounded-[var(--radius-control)] p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <Icon name="ph:arrow-up" width={15} aria-hidden />
          </Button>
          <nav
            aria-label="Folder path"
            className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto whitespace-nowrap font-mono text-[length:var(--text-sm)] [scrollbar-width:none] [&::-webkit-scrollbar]:h-0"
          >
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span key={crumb.path} className="flex flex-none items-center gap-px">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => navigateTo(crumb.path)}
                    disabled={createBusy}
                    aria-current={isLast ? "location" : undefined}
                    className={`h-auto rounded-[6px] px-1.5 py-[3px] font-mono text-[length:var(--text-sm)] ${
                      isLast ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {crumb.name}
                  </Button>
                  {!isLast ? (
                    <span className="flex flex-none text-[var(--text-muted)] opacity-50" aria-hidden>
                      <Icon name="ph:caret-right" width={13} />
                    </span>
                  ) : null}
                </span>
              );
            })}
            {crumbs.length === 0 ? <span className="px-1.5 text-[var(--text-muted)]">…</span> : null}
          </nav>
          <Button
            ref={newFolderTriggerRef}
            variant="ghost"
            size="sm"
            disabled={loading || createBusy || !cwd || creatingFolder}
            onClick={beginCreatingFolder}
            leadingIcon="ph:plus"
            className="h-[30px] flex-none rounded-[var(--radius-control)] px-2.5 text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            New folder
          </Button>
        </div>

        <div className="px-5 pb-2">
          <label className="flex h-[34px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-2.5 transition-colors focus-within:border-[color-mix(in_oklch,var(--accent-presence)_50%,transparent)]">
            <Icon name="ph:magnifying-glass" width={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
            <input
              className="h-full w-full min-w-0 bg-transparent text-base text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder="Filter folders…"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setSelectedPath(null);
              }}
              disabled={createBusy}
              aria-label="Filter folders"
            />
          </label>
        </div>

        <div className="h-px flex-none bg-[var(--border-hairline)]" />

        <div className="min-h-[120px] flex-1 overflow-y-auto px-3 pb-2.5 pt-2">
          {creatingFolder ? (
            <div
              className="mb-1 rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] p-2 [background:color-mix(in_oklch,var(--accent-presence)_6%,transparent)]"
              onKeyDown={onCreateRowKeyDown}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex flex-none text-[var(--accent-presence)]" aria-hidden>
                  <Icon name="ph:folder" width={18} />
                </span>
                <input
                  id="directory-picker-new-folder-name"
                  ref={newFolderInputRef}
                  value={newFolderName}
                  disabled={createBusy}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    setNewFolderError(null);
                  }}
                  placeholder="Folder name"
                  aria-label="New folder name"
                  aria-invalid={Boolean(newFolderError)}
                  aria-describedby={newFolderError ? `${newFolderHintId} ${newFolderErrorId}` : newFolderHintId}
                  className="ui-text-input h-8 min-w-0 flex-1 disabled:opacity-60"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={createBusy}
                  disabled={!newFolderName.trim()}
                  onClick={() => void createFolder()}
                  className="h-[30px] rounded-[var(--radius-control)] px-3"
                >
                  Create
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={createBusy}
                  onClick={cancelCreatingFolder}
                  className="h-[30px] rounded-[var(--radius-control)] px-2.5 text-[var(--text-secondary)]"
                >
                  Cancel
                </Button>
              </div>
              <p id={newFolderHintId} className="sr-only">
                Create a subfolder in the folder you&apos;re browsing now.
              </p>
              {newFolderError ? (
                <p id={newFolderErrorId} role="alert" className="mt-1.5 px-[30px] text-[length:var(--text-xs)] text-[var(--color-danger)]">
                  {newFolderError}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="px-2 py-4 text-[length:var(--text-sm)] text-[var(--color-danger)]">{error}</p>
          ) : loading && entries.length === 0 ? (
            <p className="px-2 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading…</p>
          ) : visibleEntries.length === 0 && !creatingFolder ? (
            <div className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
              <p className="text-[length:var(--text-base)] text-[var(--text-secondary)]">
                {query ? `No folders match \u201C${filter.trim()}\u201D` : "This folder is empty"}
              </p>
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                Try a different name, or create one above.
              </p>
            </div>
          ) : (
            visibleEntries.map((entry) => {
              const isSelected = selected?.path === entry.path;
              return (
                <div key={entry.path} className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPath((prev) => (prev === entry.path ? null : entry.path))}
                    onDoubleClick={() => navigateTo(entry.path)}
                    disabled={createBusy}
                    aria-pressed={isSelected}
                    className={`h-auto w-full justify-start gap-[11px] rounded-[var(--radius-card)] px-[11px] py-[9px] pr-10 text-left font-normal ${
                      isSelected
                        ? "bg-[var(--bg-hover)] shadow-[inset_0_0_0_1px_var(--accent-presence)]"
                        : ""
                    }`}
                  >
                    <span
                      className={`flex flex-none ${entry.workspace ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}`}
                      aria-hidden
                    >
                      <Icon name="ph:folder" width={18} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[length:var(--text-base)] text-[var(--text-primary)]">
                      {entry.name}
                    </span>
                    {entry.workspace ? (
                      <span
                        title="Inside a Cave workspace"
                        className="flex flex-none items-center gap-[5px] text-[length:var(--text-2xs)] uppercase tracking-[0.06em] text-[var(--accent-presence)]"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[var(--accent-presence)] shadow-[0_0_8px_var(--accent-presence)]"
                          aria-hidden
                        />
                        workspace
                      </span>
                    ) : null}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigateTo(entry.path)}
                    disabled={createBusy}
                    aria-label={`Open ${entry.name}`}
                    className="absolute right-[7px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-[7px] p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:caret-right" width={16} aria-hidden />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-[var(--border-hairline)] bg-[var(--bg-panel)] px-5 py-3.5">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-[var(--text-muted)]">Selecting</span>
            <span
              className="max-w-[260px] truncate font-mono text-[length:var(--text-sm)] text-[var(--text-secondary)]"
              title={pendingPath ?? undefined}
            >
              {pendingPath ? collapseHome(pendingPath) : "…"}
            </span>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-9 rounded-[var(--radius-control)] px-3.5 text-[length:var(--text-sm)] text-[var(--text-secondary)]"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selectDisabled}
              onClick={() => {
                if (pendingPath) onSelect(pendingPath);
              }}
              className="h-9 rounded-[var(--radius-control)] px-[18px] text-[length:var(--text-sm)] disabled:opacity-50"
            >
              {selectLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
