"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CanonicalMemoryReader,
  canonicalMemoryErrorCopy,
} from "@/components/canonical-memory-reader";
import type { Familiar } from "@/lib/types";
import { SyntaxBlock, MarkdownBlock } from "@/components/message-bubble";
import { Icon, type IconName } from "@/lib/icon";
import { Tabs } from "@/components/ui/tabs";
import { useSurfaceHistory } from "@/lib/use-surface-history";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import type { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";
import {
  loadCanonicalMemoryList,
  type CanonicalMemoryListLoad,
} from "@/lib/canonical-memory-resources";
import {
  excludeMissingCanonicalMemory,
  reconcileMissingCanonicalRefresh,
} from "@/lib/memory-rows";
import { createMemoryFeedRequestGate } from "@/lib/memory-feed-request-gate";
import { scopeMemoryFilesToFamiliar } from "@/lib/memory-file-scope";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";

type MemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  /** Familiar id when this file belongs to a specific agent workspace; absent
   *  for ownerless/global pools. Drives strict per-familiar scoping in chat. */
  familiarId?: string | null;
};

type MemoryFile = {
  ok: boolean;
  path: string;
  revealed: boolean;
  text: string;
  redactions: Record<string, number>;
  rawLength: number;
  error?: string;
};


type Props = {
  familiar: Familiar | null;
  localDaemonReady: boolean;
  /** When true, drop the outer border so the pane fits in the 296px rail. */
  compact?: boolean;
  /** When set, the Memory tab shows an "Open full memory →" footer button. */
  onOpenFullView?: () => void;
};

function InspectorEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 py-8 text-center"
    >
      <span className="text-[var(--text-muted)]" aria-hidden>
        <Icon name={icon} width={20} />
      </span>
      <p className="text-[length:var(--text-sm)] font-medium text-[var(--text-secondary)]">{title}</p>
      {hint ? (
        <p className="max-w-[28ch] text-[length:var(--text-xs)] leading-snug text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function age(iso: string): string {
  const ms = Math.abs(Date.now() - new Date(iso).getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InspectorPane({
  familiar,
  localDaemonReady,
  compact = false,
  onOpenFullView,
}: Props) {
  const shellClassName = compact
    ? "flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
    : "flex h-full min-h-0 flex-col";

  return (
    <aside className={shellClassName} aria-label="Familiar memory">
      <div className="min-h-0 flex-1 overflow-hidden">
        <MemoryTab
          key={familiar?.id ?? "all"}
          familiar={familiar}
          localDaemonReady={localDaemonReady}
          onOpenFullView={onOpenFullView}
        />
      </div>
    </aside>
  );
}

/* ---------- Memory file viewer (inline + fullscreen) ---------- */

type MemoryFileViewProps = {
  path: string;
  file: MemoryFile | null;
  reveal: boolean;
  totalRedactions: number;
  onRevealToggle: () => void;
  onBack: () => void;
};

function MemoryFileView({ path, file, reveal, totalRedactions, onRevealToggle, onBack }: MemoryFileViewProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const isMarkdown = path.endsWith(".md");
  const filename = path.split("/").slice(-2).join("/");
  const text = file?.text ?? "loading…";

  const header = (
    <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-xs">
      <button
        onClick={onBack}
        className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
      >
        ← back
      </button>
      <div className="flex-1 truncate font-mono text-[var(--text-secondary)]">{filename}</div>
      <button
        onClick={() => openGrimoireDoc("memory", path)}
        title="Open in the Memories editor"
        aria-label="Open in Memories"
        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
      >
        <Icon name="ph:book-open" width={13} />
      </button>
      <button
        onClick={() => setFullscreen((v) => !v)}
        title={fullscreen ? "Exit fullscreen" : "Open fullscreen"}
        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
      >
        <Icon name={fullscreen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={13} />
      </button>
    </div>
  );

  const toolbar = (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3 py-1.5 text-[length:var(--text-xs)]">
      <div>
        {totalRedactions > 0 ? (
          <span className="text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
        ) : (
          <span className="text-[var(--text-muted)]">no secrets detected</span>
        )}
      </div>
      <button
        onClick={onRevealToggle}
        className={`rounded px-2 py-0.5 text-[length:var(--text-2xs)] uppercase tracking-widest transition-colors ${
          reveal
            ? "bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] text-white hover:bg-[var(--color-danger)]"
            : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        }`}
        title={reveal ? "Hide secrets" : "Reveal raw (shows secrets)"}
      >
        {reveal ? "hide secrets" : "reveal secrets"}
      </button>
    </div>
  );

  const body = isMarkdown ? (
    <MarkdownBlock text={text} className="min-h-0 flex-1 overflow-auto px-4 py-4" />
  ) : (
    <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[length:var(--text-xs)]" />
  );

  const inlineView = (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {header}
      {toolbar}
      {body}
    </div>
  );

  if (!fullscreen) return inlineView;

  return (
    <>
      {inlineView}
      {createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)] [font-family:inherit]!"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5 text-xs">
            <button
              onClick={() => setFullscreen(false)}
              className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              ← back
            </button>
            <div className="flex-1 truncate font-mono text-[length:var(--text-base)] text-[var(--text-secondary)]">{filename}</div>
            <div className="flex items-center gap-2">
              {totalRedactions > 0 && (
                <span className="text-[length:var(--text-xs)] text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
              )}
              <button
                onClick={onRevealToggle}
                className={`rounded px-2.5 py-1 text-[length:var(--text-2xs)] uppercase tracking-widest transition-colors ${
                  reveal
                    ? "bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] text-white hover:bg-[var(--color-danger)]"
                    : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                }`}
                title={reveal ? "Hide secrets" : "Reveal raw (shows secrets)"}
              >
                {reveal ? "hide secrets" : "reveal secrets"}
              </button>
              <button
                onClick={() => setFullscreen(false)}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                <Icon name="ph:arrows-in-simple" width={14} />
              </button>
            </div>
          </div>
          {isMarkdown ? (
            <MarkdownBlock text={text} className="min-h-0 flex-1 overflow-auto px-8 py-6 max-w-4xl mx-auto w-full" />
          ) : (
            <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-6 py-4 text-[length:var(--text-sm)]" />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ---------- Memory tab ---------- */

type CanonicalListState =
  | { state: "loading"; entries: CanonicalMemorySummary[] }
  | { state: "ready"; entries: CanonicalMemorySummary[] }
  | {
      state: "error";
      entries: CanonicalMemorySummary[];
      error: CanonicalMemoryRequestError;
    };

const EMPTY_CANONICAL_LIST_STATE: CanonicalListState = {
  state: "loading",
  entries: [],
};

type FileListState =
  | { state: "loading"; entries: MemoryEntry[] }
  | { state: "ready"; entries: MemoryEntry[] }
  | { state: "error"; entries: MemoryEntry[]; error: string };

/** Marks a row that belongs to a shared/global pool (no familiar owner) rather
 *  than the active familiar — so "Files" never silently mixes scopes. */
function OwnershipTag() {
  return (
    <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[length:var(--text-2xs)] normal-case tracking-normal text-[var(--text-muted)]">
      shared
    </span>
  );
}

function MemoryTab({
  familiar,
  localDaemonReady,
  onOpenFullView,
}: {
  familiar: Familiar | null;
  localDaemonReady: boolean;
  onOpenFullView?: () => void;
}) {
  const { value: mode, select: selectMode } = useSurfaceHistory<"coven" | "files">({
    id: "inspector:mode",
    initial: "coven",
  });
  const [storedCanonicalState, setStoredCanonicalState] =
    useState<CanonicalListState>(EMPTY_CANONICAL_LIST_STATE);
  const canonicalState = localDaemonReady
    ? storedCanonicalState
    : EMPTY_CANONICAL_LIST_STATE;
  const [filesState, setFilesState] = useState<FileListState>({
    state: "loading",
    entries: [],
  });
  const [query, setQuery] = useState("");
  const [selectedCanonicalId, setSelectedCanonicalId] = useState<string | null>(null);
  const [missingCanonicalId, setMissingCanonicalId] = useState<string | null>(null);
  const [refreshingCanonical, setRefreshingCanonical] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<MemoryFile | null>(null);
  const [reveal, setReveal] = useState(false);
  const [canonicalRequestGate] = useState(() =>
    createMemoryFeedRequestGate(),
  );

  const applyCanonicalList = useCallback(
    (result: CanonicalMemoryListLoad): void => {
      setStoredCanonicalState((current) =>
        result.state === "ready"
          ? { state: "ready", entries: result.entries }
          : {
              state: "error",
              entries: current.entries,
              error: result.error,
            },
      );
    },
    [],
  );

  const loadCanonical = useCallback(
    async (force = false): Promise<CanonicalMemoryListLoad> => {
      const requestGate = canonicalRequestGate;
      const request = force
        ? requestGate.beginForce()
        : requestGate.beginBackground("canonical");
      if (force && requestGate.isCurrent(request)) {
        setRefreshingCanonical(true);
      }
      try {
        const result = await loadCanonicalMemoryList(force);
        if (requestGate.isCurrent(request)) {
          applyCanonicalList(result);
          if (force) {
            setMissingCanonicalId((missingMemoryId) =>
              reconcileMissingCanonicalRefresh({
                missingMemoryId,
                notice: missingMemoryId ? "Memory not found" : null,
                refreshState: result.state,
                entries: result.state === "ready" ? result.entries : [],
              }).missingMemoryId
            );
          }
        }
        return result;
      } finally {
        const current = requestGate.isCurrent(request);
        if (request.kind === "force") {
          requestGate.finishForce(request);
        }
        if (force && current) {
          setRefreshingCanonical(false);
        }
      }
    },
    [applyCanonicalList, canonicalRequestGate],
  );

  useEffect(() => {
    setStoredCanonicalState(EMPTY_CANONICAL_LIST_STATE);
    setSelectedCanonicalId(null);
    setMissingCanonicalId(null);
    setRefreshingCanonical(false);
    if (!localDaemonReady) {
      return;
    }
    canonicalRequestGate.mount();
    void loadCanonical();
    return () => {
      canonicalRequestGate.unmount();
    };
  }, [canonicalRequestGate, loadCanonical, localDaemonReady]);

  // Scope the file inventory to the active familiar AT THE SOURCE so nothing
  // beyond this familiar's own files ever reaches this chat session. The
  // server drops other familiars' files and the ownerless/global pools.
  // Re-fetch when the active familiar changes.
  useEffect(() => {
    const controller = new AbortController();
    setFilesState({ state: "loading", entries: [] });
    setOpenPath(null);
    setOpenFile(null);
    setReveal(false);
    void (async () => {
      try {
        const url = familiar
          ? `/api/memory?familiarId=${encodeURIComponent(familiar.id)}`
          : "/api/memory";
        const res = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        // Drop a stale response: switching familiars must not let the previous
        // familiar's file list overwrite the current one.
        if (controller.signal.aborted) return;
        if (!json.ok) {
          setFilesState({
            state: "error",
            entries: [],
            error: json.error ?? "Memory files unavailable",
          });
          return;
        }
        setFilesState({ state: "ready", entries: json.entries ?? [] });
      } catch (err) {
        if (controller.signal.aborted) return;
        setFilesState({
          state: "error",
          entries: [],
          error: err instanceof Error ? err.message : "Memory files unavailable",
        });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [familiar?.id]);

  useEffect(() => {
    if (!openPath) {
      setOpenFile(null);
      return;
    }
    const selectedPath = openPath;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/memory/file?path=${encodeURIComponent(selectedPath)}${reveal ? "&reveal=1" : ""}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const json = (await res.json()) as MemoryFile;
        // Drop a stale response: switching files quickly must not let an earlier
        // file's contents overwrite the newer selection.
        if (controller.signal.aborted) return;
        setOpenFile(json);
      } catch (err) {
        if (controller.signal.aborted) return;
        setOpenFile({
          ok: false,
          path: selectedPath,
          revealed: false,
          text: "",
          redactions: {},
          rawLength: 0,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [openPath, reveal]);

  // Strict per-familiar scoping (defense in depth alongside the server filter):
  // only files owned by the active familiar are shown — other familiars' files
  // and shared/global pools are withheld; `hiddenForeignCount` reports how many
  // other-familiar files were dropped.
  const filesScope = useMemo(
    () => scopeMemoryFilesToFamiliar(filesState.entries, familiar?.id),
    [filesState.entries, familiar?.id],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = filesScope.visible;
    if (!q) return rows;
    return rows.filter(
      (entry) =>
        entry.relPath.toLowerCase().includes(q) ||
        entry.rootLabel.toLowerCase().includes(q),
    );
  }, [filesScope, query]);

  const canonicalFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return excludeMissingCanonicalMemory(
      canonicalState.entries,
      missingCanonicalId,
    )
      .filter((entry) => !familiar || entry.familiarId === familiar.id)
      .filter(
        (entry) =>
          !q ||
          entry.title.toLowerCase().includes(q) ||
          entry.excerpt.toLowerCase().includes(q) ||
          entry.familiarId.toLowerCase().includes(q) ||
          entry.source.label.toLowerCase().includes(q) ||
          entry.verification.state.toLowerCase().includes(q),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [canonicalState.entries, missingCanonicalId, query, familiar]);

  useEffect(() => {
    if (
      selectedCanonicalId &&
      !canonicalFiltered.some((entry) => entry.id === selectedCanonicalId)
    ) {
      setSelectedCanonicalId(null);
    }
  }, [canonicalFiltered, selectedCanonicalId]);

  const handleMissingCanonicalMemory = useCallback((memoryId: string) => {
    setStoredCanonicalState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== memoryId),
    }));
    setSelectedCanonicalId(null);
    setMissingCanonicalId(memoryId);
  }, []);

  if (openPath) {
    const totalRedactions = openFile?.redactions
      ? Object.values(openFile.redactions).reduce((a, b) => a + b, 0)
      : 0;
    return (
      <>
        <MemoryFileView
          path={openPath}
          file={openFile}
          reveal={reveal}
          totalRedactions={totalRedactions}
          onRevealToggle={() => setReveal((v) => !v)}
          onBack={() => { setOpenPath(null); setReveal(false); }}
        />
      </>
    );
  }

  return (
    <div className="inspector-memory-tab-surface flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex items-end gap-0.5 border-b border-[var(--border-hairline)] px-2">
        <Tabs<"coven" | "files">
          bordered={false}
          size="sm"
          ariaLabel="Memory mode"
          value={mode}
          onChange={(m) => {
            setQuery("");
            selectMode(m);
          }}
          items={[
            { id: "coven", label: "Coven" },
            { id: "files", label: "Files" },
          ]}
        />
        <span className="ml-auto pb-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          {mode === "coven" ? canonicalFiltered.length : filtered.length}
        </span>
      </div>
      {mode === "coven" && selectedCanonicalId ? null : (
        <div className="border-b border-[var(--border-hairline)] p-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={mode === "coven" ? "Filter coven memory" : "Filter memory files"}
            placeholder={mode === "coven" ? "Filter coven memory…" : "Filter memory files…"}
            className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
      )}

      {mode === "coven" ? (
        !localDaemonReady ? (
          <InspectorEmpty
            icon="ph:warning"
            title={
              canonicalMemoryErrorCopy("local_daemon_required").headline
            }
            hint={
              canonicalMemoryErrorCopy("local_daemon_required").subtitle
            }
          />
        ) : selectedCanonicalId ? (
          <div className="@container/memview min-h-0 flex-1 p-2">
            <CanonicalMemoryReader
              memoryId={selectedCanonicalId}
              localDaemonReady={localDaemonReady}
              onMissing={() =>
                handleMissingCanonicalMemory(selectedCanonicalId)
              }
              onRefresh={async () => {
                await loadCanonical(true);
              }}
              onBack={() => {
                setSelectedCanonicalId(null);
              }}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[length:var(--text-xs)]">
            {missingCanonicalId ? (
              <div
                role="alert"
                className="mb-2 rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[var(--danger-text)]"
              >
                <p className="font-medium">Memory not found.</p>
                <p className="mt-1 text-[length:var(--text-2xs)]">
                  This canonical memory is no longer available. Refresh the list
                  to reconcile it.
                </p>
                <button
                  type="button"
                  disabled={refreshingCanonical}
                  onClick={() => void loadCanonical(true)}
                  className="focus-ring mt-2 rounded-[var(--radius-control)] border border-[var(--danger-border)] px-2 py-1 text-[length:var(--text-2xs)] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-60"
                >
                  {refreshingCanonical ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            ) : null}
            {canonicalState.state === "error" ? (
              canonicalState.entries.length === 0 ? (
                <InspectorEmpty
                  icon="ph:warning"
                  title="Couldn't load familiar memories"
                  hint={
                    canonicalMemoryErrorCopy(canonicalState.error.code).subtitle
                  }
                  action={{
                    label: refreshingCanonical ? "Refreshing…" : "Retry",
                    onClick: () => void loadCanonical(true),
                  }}
                />
              ) : (
                <div
                  role="alert"
                  className="mb-2 flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[var(--danger-text)]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {
                        canonicalMemoryErrorCopy(canonicalState.error.code)
                          .headline
                      }
                    </span>
                    <span className="mt-1 block text-[length:var(--text-2xs)]">
                      {
                        canonicalMemoryErrorCopy(canonicalState.error.code)
                          .subtitle
                      }
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={refreshingCanonical}
                    onClick={() => void loadCanonical(true)}
                    className="focus-ring rounded-[var(--radius-control)] border border-[var(--danger-border)] px-2 py-1 text-[length:var(--text-2xs)] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-60"
                  >
                    Retry
                  </button>
                </div>
              )
            ) : null}
            {canonicalState.state === "loading" &&
            canonicalState.entries.length === 0 ? (
              <div
                role="status"
                className="px-2 py-4 text-center text-[var(--text-muted)]"
              >
                Loading familiar memories…
              </div>
            ) : null}
            {canonicalFiltered.length === 0 &&
            canonicalState.state !== "loading" &&
            !(canonicalState.state === "error" &&
              canonicalState.entries.length === 0) ? (
              <div className="px-2 py-4 text-center text-[var(--text-muted)]">
                {query.trim()
                  ? `No coven memory matches “${query.trim()}”.`
                  : familiar
                    ? `No coven memory entries for ${familiar.display_name} yet.`
                    : "No coven memory entries yet."}
              </div>
            ) : null}
            <ul className="space-y-2">
              {canonicalFiltered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCanonicalId(entry.id);
                    }}
                    className="focus-ring w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--text-primary)]">
                          {entry.title}
                        </span>
                        <span className="mt-1 block line-clamp-3 text-[length:var(--text-2xs)] leading-snug text-[var(--text-secondary)]">
                          {entry.excerpt}
                        </span>
                      </span>
                      <time
                        dateTime={entry.updatedAt}
                        title={entry.updatedAt}
                        className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]"
                      >
                        {entry.relativeUpdatedAt}
                      </time>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-x-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                      <span>{entry.familiarId}</span>
                      <span aria-hidden>·</span>
                      <span>{entry.source.label}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {entry.privacy.classification ?? "unclassified"}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{entry.verification.state}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {mode === "files" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[length:var(--text-xs)]">
          {filesState.state === "error" ? (
            <InspectorEmpty
              icon="ph:warning"
              title="Couldn't load memory files"
              hint={filesState.error}
            />
          ) : null}
          {filesState.state === "loading" ? (
            <div
              role="status"
              className="px-2 py-4 text-center text-[var(--text-muted)]"
            >
              Loading memory files…
            </div>
          ) : null}
          {filesState.state === "ready" && filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-[var(--text-muted)]">
              No matches.
            </div>
          ) : null}
          <ul>
            {filtered.slice(0, 200).map((entry) => (
              <li key={entry.fullPath}>
                <button
                  type="button"
                  onClick={() => setOpenPath(entry.fullPath)}
                  className="focus-ring flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-raised)]/60"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[var(--text-primary)]">
                      {entry.relPath}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
                      {entry.ownership === "shared" ? <OwnershipTag /> : null}
                      <span className="truncate">{entry.rootLabel}</span>
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]"
                    title={
                      entry.modified
                        ? formatTimestamp(entry.modified, readDateTimePrefs())
                        : undefined
                    }
                  >
                    {age(entry.modified)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > 200 ? (
            <div className="px-2 py-2 text-center text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              +{filtered.length - 200} more — filter to narrow
            </div>
          ) : null}
          {familiar && filesScope.hiddenForeignCount > 0 ? (
            <div className="px-2 py-2 text-center text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              {filesScope.hiddenForeignCount} other familiar
              {filesScope.hiddenForeignCount === 1 ? "’s" : "s’"} memory
              hidden — scoped to {familiar.display_name}
            </div>
          ) : null}
        </div>
      ) : null}

      {onOpenFullView ? (
        <button
          type="button"
          className="focus-ring rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rail variant — used by the CompanionRail's Inspector tab.
// Renders the active familiar's memory tab only — drops the tab nav and
// outer border so it fits in 296px.
// ────────────────────────────────────────────────────────────────────────────

export function RailInspector({
  familiar,
  localDaemonReady,
  onOpenFullView,
}: {
  familiar: Familiar | null;
  localDaemonReady: boolean;
  onOpenFullView?: () => void;
}) {
  if (!familiar) {
    return (
      <div className="rail-empty">
        <p>Pick a familiar.</p>
      </div>
    );
  }
  return (
    <div className="rail-inspector">
      <InspectorPane
        familiar={familiar}
        localDaemonReady={localDaemonReady}
        compact={true}
        onOpenFullView={onOpenFullView}
      />
    </div>
  );
}
