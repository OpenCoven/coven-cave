"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Familiar } from "@/lib/types";
import { SyntaxBlock, MarkdownBlock } from "@/components/message-bubble";
import { Icon, type IconName } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
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
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <span className="text-[var(--text-muted)]" aria-hidden>
        <Icon name={icon} width={20} />
      </span>
      <p className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</p>
      {hint ? (
        <p className="max-w-[28ch] text-[11px] leading-snug text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
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
  compact = false,
  onOpenFullView,
}: Props) {
  const shellClassName = compact
    ? "flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
    : "flex h-full min-h-0 flex-col";

  return (
    <aside className={shellClassName} aria-label="Familiar memory">
      <div className="min-h-0 flex-1 overflow-hidden">
        <MemoryTab familiar={familiar} onOpenFullView={onOpenFullView} />
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
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3 py-1.5 text-[11px]">
      <div>
        {totalRedactions > 0 ? (
          <span className="text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
        ) : (
          <span className="text-[var(--text-muted)]">no secrets detected</span>
        )}
      </div>
      <button
        onClick={onRevealToggle}
        className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
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
    <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[11px]" />
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
          className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]"
          style={{ fontFamily: "inherit" }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5 text-xs">
            <button
              onClick={() => setFullscreen(false)}
              className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              ← back
            </button>
            <div className="flex-1 truncate font-mono text-[13px] text-[var(--text-secondary)]">{filename}</div>
            <div className="flex items-center gap-2">
              {totalRedactions > 0 && (
                <span className="text-[11px] text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
              )}
              <button
                onClick={onRevealToggle}
                className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
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
            <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-6 py-4 text-[12px]" />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ---------- Memory tab ---------- */

type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  /** Server-resolved absolute path, attached by /api/coven-memory only when the
   *  entry passes the memory allow-list. Absent otherwise (then no open-file
   *  affordance is shown). Never guessed on the client. */
  fullPath?: string;
  updated_at: string;
  excerpt?: string;
};

/** Marks a row that belongs to a shared/global pool (no familiar owner) rather
 *  than the active familiar — so "Files" never silently mixes scopes. */
function OwnershipTag() {
  return (
    <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[9px] normal-case tracking-normal text-[var(--text-muted)]">
      shared
    </span>
  );
}

function MemoryTab({
  familiar,
  onOpenFullView,
}: {
  familiar: Familiar | null;
  onOpenFullView?: () => void;
}) {
  const [mode, setMode] = useState<"coven" | "files">("coven");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [covenLoaded, setCovenLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<MemoryFile | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/coven-memory", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          const fetched: CovenMemoryEntry[] = json.entries ?? [];
          setCovenEntries(fetched);
        } else {
          /* Inspector remains the default; the legacy Coven tab can stay empty. */
        }
      } catch {
        /* Inspector remains the default; the legacy Coven tab can stay empty. */
      } finally {
        if (!cancelled) setCovenLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Scope the file inventory to the active familiar AT THE SOURCE so nothing
  // beyond this familiar's own files ever reaches this chat session. The
  // server drops other familiars' files and the ownerless/global pools.
  // Re-fetch when the active familiar changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = familiar
          ? `/api/memory?familiarId=${encodeURIComponent(familiar.id)}`
          : "/api/memory";
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        // Drop a stale response: switching familiars must not let the previous
        // familiar's file list overwrite the current one.
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? "memory list failed");
          return;
        }
        setEntries(json.entries ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "fetch failed");
      }
    })();
    return () => { cancelled = true; };
  }, [familiar?.id]);

  useEffect(() => {
    if (!openPath) {
      setOpenFile(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/memory/file?path=${encodeURIComponent(openPath)}${reveal ? "&reveal=1" : ""}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as MemoryFile;
        // Drop a stale response: switching files quickly must not let an earlier
        // file's contents overwrite the newer selection.
        if (cancelled) return;
        setOpenFile(json);
      } catch (err) {
        if (cancelled) return;
        setOpenFile({
          ok: false,
          path: openPath,
          revealed: false,
          text: "",
          redactions: {},
          rawLength: 0,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [openPath, reveal]);

  // Strict per-familiar scoping (defense in depth alongside the server filter):
  // only files owned by the active familiar are shown — other familiars' files
  // and shared/global pools are withheld; `hiddenForeignCount` reports how many
  // other-familiar files were dropped.
  const filesScope = useMemo(
    () => scopeMemoryFilesToFamiliar(entries, familiar?.id),
    [entries, familiar?.id],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = filesScope.visible;
    if (!q) return rows;
    return rows.filter((e) => e.relPath.toLowerCase().includes(q) || e.rootLabel.toLowerCase().includes(q));
  }, [filesScope, query]);

  const covenFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return covenEntries
      .filter((e) => !familiar || e.familiar_id === familiar.id)
      .filter(
        (e) =>
          !q ||
          e.title.toLowerCase().includes(q) ||
          (e.excerpt ?? "").toLowerCase().includes(q) ||
          e.familiar_id.toLowerCase().includes(q),
      )
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [covenEntries, query, familiar]);

  if (error) {
    return (
      <InspectorEmpty
        icon="ph:warning"
        title="Memory unavailable"
        hint={error}
      />
    );
  }

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
            setMode(m);
          }}
          items={[
            { id: "coven", label: "Coven" },
            { id: "files", label: "Files" },
          ]}
        />
        <span className="ml-auto pb-1.5 text-[10px] text-[var(--text-muted)]">
          {mode === "coven" ? covenFiltered.length : filtered.length}
        </span>
      </div>
      <div className="border-b border-[var(--border-hairline)] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "coven" ? "Filter coven memory…" : "Filter memory files…"}
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
        />
      </div>

      {mode === "coven" ? (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
          {covenFiltered.length === 0 ? (
            <li className="px-2 py-4 text-center text-[var(--text-muted)]">
              {!covenLoaded ? (
                "Loading…"
              ) : covenEntries.length === 0 ? (
                <span>
                  Coven memory API returned nothing.
                  <br />
                  <button
                    onClick={() => setMode("files")}
                    className="mt-1 text-[var(--accent-presence)] hover:text-[var(--accent-presence)] underline"
                  >
                    Browse memory files →
                  </button>
                </span>
              ) : query.trim() ? (
                `No coven memory matches “${query.trim()}”.`
              ) : familiar ? (
                `No coven memory entries for ${familiar.display_name} yet.`
              ) : (
                "No coven memory entries yet."
              )}
            </li>
          ) : null}
          {covenFiltered.map((e) => (
            <li key={e.id} className="mb-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[10px] text-[var(--text-secondary)]">
                    {e.familiar_id}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">{e.title}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                  {e.updated_at}
                </span>
              </div>
              {e.excerpt ? (
                <p className="mt-1 line-clamp-3 text-[10px] leading-snug text-[var(--text-secondary)]">
                  {e.excerpt}
                </p>
              ) : null}
              {e.fullPath ? (
                <button
                  onClick={() => {
                    // Open the underlying file in the redacted file viewer via the
                    // SERVER-resolved absolute path — /api/coven-memory attaches
                    // `fullPath` only when the entry passes the memory allow-list.
                    // No client-side home-directory guessing (which hardcoded one
                    // developer's ~/.coven path and broke on every other machine).
                    setOpenPath(e.fullPath!);
                  }}
                  className="mt-1 text-[10px] text-[var(--accent-presence)] hover:text-[var(--accent-presence)]"
                >
                  open file →
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "files" ? (
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {filtered.length === 0 ? (
          <li className="px-2 py-4 text-center text-[var(--text-muted)]">No matches.</li>
        ) : null}
        {filtered.slice(0, 200).map((e) => (
          <li key={e.fullPath}>
            <button
              onClick={() => setOpenPath(e.fullPath)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-raised)]/60"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[var(--text-primary)]">{e.relPath}</span>
                <span className="flex items-center gap-1 truncate text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {e.ownership === "shared" ? <OwnershipTag /> : null}
                  <span className="truncate">{e.rootLabel}</span>
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]" title={e.modified ? formatTimestamp(e.modified, readDateTimePrefs()) : undefined}>{age(e.modified)}</span>
            </button>
          </li>
        ))}
        {filtered.length > 200 ? (
          <li className="px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
            +{filtered.length - 200} more — filter to narrow
          </li>
        ) : null}
        {familiar && filesScope.hiddenForeignCount > 0 ? (
          <li className="px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
            {filesScope.hiddenForeignCount} other familiar
            {filesScope.hiddenForeignCount === 1 ? "’s" : "s’"} memory hidden — scoped to {familiar.display_name}
          </li>
        ) : null}
      </ul>
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
  onOpenFullView,
}: {
  familiar: Familiar | null;
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
      <InspectorPane familiar={familiar} compact={true} onOpenFullView={onOpenFullView} />
    </div>
  );
}
