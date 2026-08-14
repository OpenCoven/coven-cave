"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";
import {
  LOCAL_PROJECT_CREATION_MESSAGE,
  LOCAL_REQUEST_REQUIRED_CODE,
} from "@/lib/project-errors";
import {
  isPinned,
  readPins,
  togglePin,
  writePins,
  type PinnedPlace,
} from "@/lib/directory-picker-pins";

type DirEntry = { name: string; path: string; workspace?: boolean };
type BrowseResponse = {
  ok: boolean;
  home?: string;
  cwd?: string;
  parent?: string | null;
  entries?: DirEntry[];
  code?: string;
  error?: string;
};

/** Sidebar shapes mirrored from home-browse.ts (a server-only module). */
type Place = { id: string; name: string; path: string; kind: "home" | "known" | "drive" | "pinned" };
type PlaceGroup = { id: string; label: string; places: Place[] };
type PlacesResponse = { ok: boolean; home?: string; groups?: PlaceGroup[] };

/** Known-folder id → glyph, so the rail reads like Explorer's sidebar. */
const PLACE_ICONS: Record<string, IconName> = {
  home: "ph:house",
  desktop: "ph:desktop",
  downloads: "ph:download-simple",
  documents: "ph:file-text",
  pictures: "ph:image",
  music: "ph:music-notes",
  videos: "ph:video",
};

function placeIcon(place: Place): IconName {
  if (place.kind === "drive") return "ph:hard-drives";
  if (place.kind === "pinned") return "ph:push-pin-fill";
  return PLACE_ICONS[place.id] ?? "ph:folder";
}

/** Pseudo-location the fs-browse API uses to list volume roots (drives). */
const DRIVES = "::drives";

/**
 * Path separator of the server's native paths ("\" only for a Windows host),
 * derived once from the trusted $HOME the fs-browse API reports. Sniffing
 * each path for backslashes misclassifies POSIX folder names that legally
 * contain "\" and corrupts their crumbs.
 */
function serverSep(home: string | null): "/" | "\\" {
  return home && (/^[A-Za-z]:/.test(home) || home.startsWith("\\\\")) ? "\\" : "/";
}

/** True for a bare volume root: "/" or a Windows drive root like "C:\". */
function isVolumeRootPath(value: string): boolean {
  return value === "/" || /^[A-Za-z]:[\\/]$/.test(value);
}

/** Trailing path segment, volume roots yielding themselves ("/" → "/"). */
function baseName(value: string, sep: "/" | "\\"): string {
  return value.slice(value.lastIndexOf(sep) + 1) || value;
}
type CreateFolderResponse = {
  ok: boolean;
  path?: string;
  code?: string;
  error?: string;
};

function isCreateFolderResponse(value: unknown): value is CreateFolderResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as { ok?: unknown; path?: unknown; code?: unknown; error?: unknown };
  return (
    typeof body.ok === "boolean" &&
    (typeof body.path === "string" || typeof body.path === "undefined") &&
    (typeof body.code === "string" || typeof body.code === "undefined") &&
    (typeof body.error === "string" || typeof body.error === "undefined")
  );
}

function browseErrorMessage(
  body: { code?: string; error?: string },
  fallback: string,
): string {
  return body.code === LOCAL_REQUEST_REQUIRED_CODE
    ? LOCAL_PROJECT_CREATION_MESSAGE
    : body.error ?? fallback;
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
 * Web folder browser for the "New project" form. Navigates the filesystem one
 * level at a time via GET /api/fs-browse (loopback-only). Browsing opens at
 * $HOME but can walk above it to any volume root, and the ::drives
 * pseudo-location switches drives on multi-volume machines. The desktop build
 * uses the native OS dialog instead of this modal.
 *
 * Interaction model (project-folder-modal redesign): clicking a row selects it
 * without entering; the trailing chevron (or double-click) opens it. The footer
 * echoes the pending path and the primary action names the folder it will
 * select — the current folder when nothing is highlighted. $HOME itself and
 * bare volume roots are never selectable (registering a whole home directory
 * or drive is always a mistake), matching isAllowedNewProjectRoot on the
 * server.
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
  const [placeGroups, setPlaceGroups] = useState<PlaceGroup[]>([]);
  const [pins, setPins] = useState<PinnedPlace[]>([]);
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
        setError(browseErrorMessage(body, "Could not read that folder"));
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

  // The sidebar is an accelerator, not a prerequisite: a failed places fetch
  // leaves the rail empty and browsing from $HOME still works, so this never
  // surfaces an error the way `load` does.
  const loadPlaces = useCallback(async (sessionGeneration: number) => {
    try {
      const res = await fetch("/api/fs-browse?places=1", { cache: "no-store" });
      const body = (await res.json()) as PlacesResponse;
      if (sessionGeneration !== modalSessionRef.current) return;
      if (res.ok && body.ok && body.groups) setPlaceGroups(body.groups);
    } catch {
      /* offline or loopback-gated — the rail simply stays empty */
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
    if (open) {
      void load(null, sessionGeneration);
      void loadPlaces(sessionGeneration);
      setPins(readPins());
    } else {
      loadGenerationRef.current += 1;
      setHome(null);
      setCwd(null);
      setParent(null);
      setEntries([]);
      setLoading(false);
      setError(null);
      setFilter("");
      setSelectedPath(null);
      setPlaceGroups([]);
      resetCreateFolderState();
    }
  }, [open, load, loadPlaces, resetCreateFolderState]);

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
        setNewFolderError(browseErrorMessage(body ?? {}, "Could not create that folder"));
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

  // Breadcrumb trail down to the current folder: `~`-anchored while inside
  // $HOME (the familiar shape), volume-root-anchored above it ("/", "C:\"),
  // and a single "Drives" crumb on the drives list. Separator-aware so the
  // Windows web build gets real crumbs instead of one unsplit path.
  const crumbs = useMemo(() => {
    if (!cwd) return [];
    if (cwd === DRIVES) return [{ name: "Drives", path: DRIVES }];
    const sep = serverSep(home);
    const trail: Array<{ name: string; path: string }> = [];
    let acc: string;
    if (home && (cwd === home || cwd.startsWith(home + sep))) {
      acc = home;
      trail.push({ name: "~", path: home });
    } else {
      acc = sep === "\\" ? cwd.slice(0, cwd.indexOf("\\") + 1) : "/";
      trail.push({ name: acc, path: acc });
    }
    for (const segment of cwd.slice(acc.length).split(sep).filter(Boolean)) {
      acc = acc.endsWith(sep) ? acc + segment : acc + sep + segment;
      trail.push({ name: segment, path: acc });
    }
    return trail;
  }, [cwd, home]);

  // Pins ride along in Quick access, exactly where Explorer puts them — the
  // server owns the fixed half of that group, the browser owns the rest.
  const railGroups = useMemo(() => {
    const pinnedPlaces: Place[] = pins.map((pin) => ({
      id: `pin:${pin.path}`,
      name: pin.name,
      path: pin.path,
      kind: "pinned",
    }));
    return placeGroups.map((group) =>
      group.id === "quick" ? { ...group, places: [...group.places, ...pinnedPlaces] } : group,
    );
  }, [placeGroups, pins]);

  if (!open) return null;

  const onTogglePin = (entry: DirEntry) => {
    const next = togglePin(pins, { name: entry.name, path: entry.path });
    setPins(next);
    writePins(next);
  };

  const sep = serverSep(home);
  const collapseHome = (value: string) =>
    home && (value === home || value.startsWith(home + sep))
      ? "~" + value.slice(home.length)
      : value;

  const query = filter.trim().toLowerCase();
  const visibleEntries = query ? entries.filter((e) => e.name.toLowerCase().includes(query)) : entries;
  const selected = selectedPath ? entries.find((e) => e.path === selectedPath) ?? null : null;

  const atHomeRoot = cwd !== null && cwd === home;
  const atDrivesList = cwd === DRIVES;
  const pendingPath = selected?.path ?? (atDrivesList ? null : cwd);
  const pendingName = selected ? selected.name : atHomeRoot || !cwd || atDrivesList ? null : baseName(cwd, sep);
  const selectLabel = pendingName ? `Select ${truncateName(pendingName)}` : atDrivesList ? "Open a drive" : "Select home";
  // $HOME itself and bare volume roots are never valid project roots
  // (isAllowedNewProjectRoot excludes both as unbounded), so selection stays
  // disabled there until the user highlights or enters a subfolder.
  const selectDisabled =
    !cwd || createBusy || !pendingPath || pendingPath === home || isVolumeRootPath(pendingPath);

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
        className="flex w-[760px] max-w-full max-h-[min(680px,92dvh)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] shadow-[0_30px_70px_-18px_oklch(0_0_0/70%),0_0_0_1px_color-mix(in_oklch,var(--foreground)_4%,transparent)] [animation:ui-modal-enter_var(--duration-base)_var(--ease-decelerate)] motion-reduce:[animation:none] focus:outline-none"
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

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Places"
            className="flex w-[196px] flex-none flex-col gap-3.5 overflow-y-auto border-r border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-2.5"
          >
            {railGroups.map((group) => (
              <div key={group.id} className="flex flex-col gap-px">
                <span className="px-2 pb-1 text-[length:var(--text-2xs)] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  {group.label}
                </span>
                {group.places.map((place) => {
                  const isCurrent = place.path === cwd;
                  return (
                    <Button
                      key={place.id}
                      variant="ghost"
                      size="sm"
                      disabled={createBusy}
                      onClick={() => navigateTo(place.path)}
                      aria-current={isCurrent ? "location" : undefined}
                      title={place.path}
                      className={`h-auto w-full justify-start gap-2.5 rounded-[var(--radius-control)] px-2 py-[7px] text-left font-normal ${
                        isCurrent ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
                      }`}
                    >
                      <span
                        className={`flex flex-none ${
                          place.kind === "pinned"
                            ? "text-[var(--accent-presence)]"
                            : "text-[var(--text-muted)]"
                        }`}
                        aria-hidden
                      >
                        <Icon name={placeIcon(place)} width={16} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                        {place.name}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5 px-3.5 pb-3 pt-0.5">
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
                disabled={loading || createBusy || !cwd || creatingFolder || cwd === DRIVES}
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
                  const pinned = isPinned(pins, entry.path);
                  return (
                    <div key={entry.path} className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          atDrivesList
                            ? navigateTo(entry.path)
                            : setSelectedPath((prev) => (prev === entry.path ? null : entry.path))
                        }
                        onDoubleClick={() => navigateTo(entry.path)}
                        disabled={createBusy}
                        aria-pressed={isSelected}
                        className={`h-auto w-full justify-start gap-[11px] rounded-[var(--radius-card)] px-[11px] py-[9px] pr-[68px] text-left font-normal ${
                          isSelected
                            ? "bg-[var(--bg-hover)] shadow-[inset_0_0_0_1px_var(--accent-presence)]"
                            : ""
                        }`}
                      >
                        <span
                          className={`flex flex-none ${entry.workspace ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}`}
                          aria-hidden
                        >
                          <Icon name={atDrivesList ? "ph:hard-drives" : "ph:folder"} width={18} />
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
                      {atDrivesList ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onTogglePin(entry)}
                          disabled={createBusy}
                          aria-pressed={pinned}
                          aria-label={pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
                          title={pinned ? "Remove from Quick access" : "Pin to Quick access"}
                          className={`absolute right-[35px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-[7px] p-0 ${
                            pinned
                              ? "text-[var(--accent-presence)]"
                              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          <Icon name={pinned ? "ph:push-pin-fill" : "ph:push-pin"} width={15} aria-hidden />
                        </Button>
                      )}
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
          </div>
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
