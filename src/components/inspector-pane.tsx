"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Familiar } from "@/lib/types";
import { SyntaxBlock, MarkdownBlock } from "@/components/message-bubble";
import { Icon, type IconName } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { HarnessCapabilityManifest } from "@/app/api/capabilities/route";
import type { RoleEntry } from "@/app/api/roles/route";
import type { LocalSkillEntry } from "@/app/api/skills/local/route";
import type { AdapterReport } from "@/lib/harness-adapters";
import { scopeMemoryFilesToFamiliar } from "@/lib/memory-file-scope";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";

export type Tab = "memory" | "familiar";



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
  /** Which section to render. The pane is a controlled section body — the
   *  chat surface's Familiar tab and the companion RailInspector each drive
   *  the one section they need, so there is no nested tab strip here.
   *  Defaults to memory for the compact rail variant. */
  tab?: Tab;
  /** Daemon reachability — drives the identity hero's presence line on the
   *  chat surface's Familiar tab. Absent for the compact memory rail. */
  daemonRunning?: boolean;
  /** Starts a fresh chat with this familiar (the hero's primary action).
   *  Provided by the chat surface; absent for the compact memory rail. */
  onStartChat?: (familiarId: string) => void;
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
  tab = "memory",
  daemonRunning,
  onStartChat,
}: Props) {
  const shellClassName = compact
    ? "flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
    : // Non-compact renders inside the chat surface's Familiar tab, whose host
      // owns the surrounding chrome — the pane itself stays transparent.
      "flex h-full min-h-0 flex-col";

  return (
    <aside
      className={shellClassName}
      aria-label={tab === "familiar" ? "Familiar profile" : "Familiar memory"}
    >
      <div
        className={`min-h-0 flex-1 ${
          tab === "memory" ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {tab === "memory" ? <MemoryTab familiar={familiar} onOpenFullView={onOpenFullView} /> : null}
        {tab === "familiar" ? (
          <FamiliarCapabilityPanel familiar={familiar} daemonRunning={daemonRunning} onStartChat={onStartChat} />
        ) : null}
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

/* ---------- Tools tab ---------- */

/* ---------- Familiar Capability Panel ----------
 *
 * Full per-familiar capability picture with inheritance chain:
 *   Layer 1: Active Roles  (roles[] where active && familiar matches)
 *   Layer 2: Local Skills  (familiar-specific + global workspace skills)
 *   Layer 3: Harness       (plugins, MCP, scan metadata from capabilities scan)
 */

// ── Shared UI primitives ─────────────────────────────────────────────────────

function CapSection({
  title,
  scope,
  empty,
  emptyText,
  children,
}: {
  title: string;
  scope?: string;
  empty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          {title}
        </h3>
        {scope ? (
          <span className="text-[10px] text-[var(--text-muted)]">{scope}</span>
        ) : null}
      </header>
      {empty ? (
        <p className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-2 text-[var(--text-muted)]">
          {emptyText ?? "Nothing here."}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function CapRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={`truncate text-[var(--text-primary)] ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </span>
    </li>
  );
}

/** Neutral kind marker — the kind is metadata, not a status: one quiet style
 *  for every kind (the old per-kind color map was accent soup on every row). */
function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="rounded bg-[var(--bg-raised)] px-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
      {kind || "—"}
    </span>
  );
}

/** Navigate the workspace to a management surface (Roles / Capabilities /
 *  Marketplace hub) through the same `cave:navigate-mode` bridge every other
 *  cross-surface link uses. */
function navigateMode(mode: "roles" | "capabilities" | "marketplace"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}

/** Teach-state CTA — every empty state gets a real affordance, not a
 *  dead-end sentence naming a page. */
function CapCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="familiar-tab__cta focus-ring mt-1.5 inline-flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
    >
      {label}
    </button>
  );
}

/** One de-boxed skill row, shared by all three provenance groups: quiet name
 *  + kind, one-line description, neutral tag chips — and the source path
 *  demoted from body copy to a hover/focus tooltip. */
function SkillItem({
  name,
  kind,
  description,
  tags,
  sourcePath,
}: {
  name: string;
  kind: string;
  description?: string;
  tags?: string[];
  sourcePath?: string;
}) {
  return (
    <li className="px-2 py-1.5" title={sourcePath}>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        <KindBadge kind={kind} />
      </div>
      {description ? (
        <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">{description}</p>
      ) : null}
      {tags && tags.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded bg-[var(--bg-raised)] px-1 text-[10px] text-[var(--text-muted)]"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="familiar-tab__list">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-1.5 rounded-[inherit] px-2 py-1.5 text-left hover:bg-[var(--bg-raised)]/40"
      >
        <Icon
          name={open ? "ph:caret-down" : "ph:caret-right"}
          width={10}
          className="shrink-0 text-[var(--text-muted)]"
        />
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          {title}
        </span>
        {badge ? (
          <span className="ml-auto rounded bg-[var(--bg-raised)] px-1 py-px text-[10px] text-[var(--text-muted)]">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? <div className="px-2 pb-2">{children}</div> : null}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

/**
 * Identity hero — answers "who am I chatting with?" before the capability
 * plumbing below. Needs nothing from the capability fetches (everything here
 * lives on the Familiar object), so it paints immediately while the grid
 * below is still loading. Aligned with the roster-card identity idiom
 * (avatar + name + role + presence) and the profile-card routes from
 * cave-ujbr rather than inventing a second identity presentation.
 */
function FamiliarIdentityHero({
  familiar,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar;
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  // Resolve Cave-local overrides (display name, avatar image, glyph) the same
  // way every other identity surface does.
  const heroList = useMemo(() => [familiar], [familiar]);
  const resolved = useResolvedFamiliars(heroList, { includeArchived: true })[0];
  const activeSessions = familiar.active_sessions ?? 0;
  const roleLine = [resolved?.role || familiar.role, familiar.pronouns]
    .filter(Boolean)
    .join(" · ");
  const runtimeLine = [familiar.harness, familiar.model].filter(Boolean).join(" · ");

  return (
    <header className="familiar-tab__hero">
      {resolved ? (
        <span className="familiar-tab__avatar">
          <FamiliarAvatar familiar={resolved} size="xl" expandable />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="familiar-tab__name">{resolved?.display_name ?? familiar.display_name}</h2>
          <span className="familiar-tab__presence text-[11px] text-[var(--text-muted)]">
            <span
              aria-hidden="true"
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                daemonRunning ? "bg-[var(--accent-presence)]" : "bg-[var(--text-muted)]"
              }`}
            />
            {daemonRunning ? "online" : "offline"}
            {activeSessions > 0 ? (
              <span className="rounded bg-[var(--accent-presence)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent-presence)]">
                {activeSessions} active session{activeSessions === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </div>
        {roleLine ? (
          <p className="mt-0.5 truncate text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">
            {roleLine}
          </p>
        ) : null}
        {familiar.description ? (
          <p className="mt-1.5 max-w-[64ch] text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {familiar.description}
          </p>
        ) : null}
        <div className="familiar-tab__links mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {runtimeLine ? (
            <span className="font-mono text-[10px] text-[var(--text-muted)]" title="Harness · model">
              {runtimeLine}
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-3">
            <Link
              href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/profile`}
              aria-label={`Open profile card for ${familiar.display_name}`}
              className="focus-ring shrink-0 rounded-[var(--radius-sm)] text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
            >
              Profile →
            </Link>
            <Link
              href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`}
              aria-label={`Open analytics for ${familiar.display_name}`}
              className="focus-ring shrink-0 rounded-[var(--radius-sm)] text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
            >
              Analytics →
            </Link>
            {/* The sibling memory pane isn't reachable from this tab — bridge
                to the Studio's per-familiar Memory tab, its managed home. */}
            <button
              type="button"
              onClick={() => openFamiliarStudioSettingsTab("memory", familiar.id)}
              aria-label={`Open memory for ${familiar.display_name}`}
              className="focus-ring shrink-0 rounded-[var(--radius-sm)] text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
            >
              Memory →
            </button>
            <button
              type="button"
              onClick={() => openFamiliarStudioSettingsTab("identity", familiar.id)}
              aria-label={`Edit ${familiar.display_name} in the Familiar Studio`}
              className="focus-ring shrink-0 rounded-[var(--radius-sm)] text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
            >
              Edit in Studio →
            </button>
          </span>
        </div>
      </div>
      {onStartChat ? (
        <div className="shrink-0">
          {/* The surface's primary action: start a fresh session with this
              familiar. The one filled-accent control on the tab. */}
          <button
            type="button"
            onClick={() => onStartChat(familiar.id)}
            className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-2.5 text-[11px] font-medium text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90"
          >
            <Icon name="ph:chat-circle-dots" width={13} aria-hidden />
            New chat
          </button>
        </div>
      ) : null}
    </header>
  );
}

function FamiliarCapabilityPanel({
  familiar,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar | null;
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkillEntry[]>([]);
  const [harnessCapabilities, setHarnessCapabilities] = useState<HarnessCapabilityManifest[]>([]);
  const [harnesses, setHarnesses] = useState<AdapterReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Collapsible state per sub-group
  const [skillsRoleOpen, setSkillsRoleOpen] = useState(true);
  const [skillsFamiliarOpen, setSkillsFamiliarOpen] = useState(true);
  const [skillsGlobalOpen, setSkillsGlobalOpen] = useState(true);

  const harnessId = familiar?.harness ?? "codex";

  useEffect(() => {
    if (!familiar) return;
    setLoading(true);
    setErrors([]);

    const errs: string[] = [];

    void Promise.all([
      fetch("/api/roles", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; roles?: RoleEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "roles fetch failed" })),
      fetch("/api/skills/local", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; skills?: LocalSkillEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "skills/local fetch failed" })),
      fetch(`/api/capabilities?harness=${encodeURIComponent(harnessId)}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harness_capabilities?: HarnessCapabilityManifest[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "capabilities fetch failed" })),
      fetch("/api/harnesses", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harnesses?: AdapterReport[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "harnesses fetch failed" })),
    ]).then(([rolesRes, skillsRes, capsRes, harnessesRes]) => {
      if (rolesRes.ok) setRoles(rolesRes.roles ?? []);
      else errs.push(rolesRes.error ?? "roles unavailable");

      if (skillsRes.ok) setLocalSkills(skillsRes.skills ?? []);
      else errs.push(skillsRes.error ?? "local skills unavailable");

      if (capsRes.ok) setHarnessCapabilities(capsRes.harness_capabilities ?? []);
      else errs.push(capsRes.error ?? "capabilities unavailable");

      if (harnessesRes.ok) setHarnesses(harnessesRes.harnesses ?? []);
      else errs.push(harnessesRes.error ?? "harnesses unavailable");

      setErrors(errs);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiar?.id]);

  if (!familiar) {
    return (
      <InspectorEmpty
        icon="ph:sparkle"
        title="No familiar selected"
        hint="Pick a familiar to see its roles, skills, and runtime capabilities."
      />
    );
  }

  // The identity hero needs nothing from the capability fetches — paint it
  // immediately and keep the shimmer for the capability grid alone, shaped
  // like the grid it resolves into.
  if (loading) {
    return (
      <div className="familiar-tab flex flex-col gap-2 p-4 text-xs">
        <FamiliarIdentityHero familiar={familiar} daemonRunning={daemonRunning} onStartChat={onStartChat} />
        <div className="familiar-tab__grid" aria-hidden>
          <SkeletonRows count={5} className="p-3" />
          <SkeletonRows count={5} className="p-3" />
        </div>
      </div>
    );
  }

  // ── Derive inheritance layers ────────────────────────────────────────────────

  // Layer 1: Active roles for this familiar (or "all" / "global")
  const activeRoles = roles.filter(
    (r) =>
      r.active &&
      (r.familiar === familiar.id || r.familiar === "all" || r.familiar === "global"),
  );
  const roleGrantedSkillIds = new Set(activeRoles.flatMap((r) => r.skills));

  // Layer 2: Local skills
  const globalSkills = localSkills.filter((s) => s.familiar === "global");
  const familiarSkills = localSkills.filter((s) => s.familiar === familiar.id);

  // Layer 3: Harness capability manifest
  const harnessManifest =
    harnessCapabilities.find((m) => m.harness_id === harnessId) ?? null;
  const harnessPlugins = harnessManifest?.plugins ?? [];
  const mcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() === "mcp");
  const nonMcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() !== "mcp");
  const warnings = harnessManifest?.warnings ?? [];

  // The bound harness metadata
  const harnessReport = harnesses.find((h) => h.id === harnessId) ?? null;

  // Total unique skill ids across all layers
  const allSkillIds = new Set([
    ...familiarSkills.map((s) => s.id),
    ...globalSkills.map((s) => s.id),
    ...Array.from(roleGrantedSkillIds),
  ]);

  return (
    <div className="familiar-tab flex flex-col gap-2 p-4 text-xs">

      {/* ── Identity hero ─────────────────────────────────────────────────── */}
      <FamiliarIdentityHero familiar={familiar} daemonRunning={daemonRunning} onStartChat={onStartChat} />

      {/* Error banner */}
      {errors.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded border border-[color-mix(in_oklch,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
        >
          <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="min-w-0">
            {errors.map((e, i) => (
              <p key={i} className="text-[10px] text-[var(--color-warning)]">{e}</p>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Capability grid: two columns on a wide canvas, one below ─────── */}
      <div className="familiar-tab__grid">
      <div className="familiar-tab__col flex min-w-0 flex-col gap-2">

      {/* ── Section 1: Roles ──────────────────────────────────────────────── */}
      <CapSection title="Roles" scope={`active: ${activeRoles.length}`}>
        {activeRoles.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--border-hairline)] px-3 py-2.5 text-[var(--text-muted)]">
            <p>No roles active for this familiar.</p>
            <CapCta label="Open Roles →" onClick={() => navigateMode("roles")} />
          </div>
        ) : (
          <div className="familiar-tab__list">
            <ul className="familiar-tab__rows">
              {activeRoles.map((role) => (
                <li
                  key={`${role.familiar}:${role.id}`}
                  className="px-3 py-2"
                  title={`Inherited from roles/${role.id}/ROLE.md`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon name="ph:sparkle" width={13} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                    <span className="font-medium text-[var(--text-primary)]">{role.name}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                      {role.familiar}
                    </span>
                    {role.skills.length > 0 ? (
                      <span className="rounded bg-[var(--bg-raised)] px-1 text-[10px] text-[var(--text-muted)]">
                        {role.skills.length} skill{role.skills.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {role.description ? (
                    <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">
                      {role.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CapSection>

      {/* ── Section 2: Skills (3 sub-groups) ──────────────────────────────── */}
      <CapSection title="Skills" scope={`${allSkillIds.size} total`}>
        <div className="flex flex-col gap-1.5">

          {/* Role-granted */}
          {roleGrantedSkillIds.size > 0 ? (
            <CollapsibleSection
              title="Role-granted"
              badge={`${roleGrantedSkillIds.size} via active roles`}
              open={skillsRoleOpen}
              onToggle={() => setSkillsRoleOpen((v) => !v)}
            >
              <ul className="familiar-tab__rows pt-1">
                {Array.from(roleGrantedSkillIds).map((sid) => {
                  const skill = localSkills.find((s) => s.id === sid);
                  return (
                    <SkillItem
                      key={sid}
                      name={skill?.name ?? sid}
                      kind={skill?.kind ?? "agent"}
                      description={skill?.description}
                      tags={skill?.tags}
                      sourcePath="Granted by an active role"
                    />
                  );
                })}
              </ul>
            </CollapsibleSection>
          ) : null}

          {/* Familiar-specific */}
          <CollapsibleSection
            title="Familiar"
            badge={String(familiarSkills.length)}
            open={skillsFamiliarOpen}
            onToggle={() => setSkillsFamiliarOpen((v) => !v)}
          >
            {familiarSkills.length === 0 ? (
              <div className="px-1 pb-1 pt-1 text-[10px] text-[var(--text-muted)]">
                <p>No skills installed for this familiar yet.</p>
                <CapCta label="Browse Marketplace →" onClick={() => navigateMode("marketplace")} />
              </div>
            ) : (
              <ul className="familiar-tab__rows pt-1">
                {familiarSkills.map((s) => (
                  <SkillItem
                    key={s.path}
                    name={s.name}
                    kind={s.kind ?? "agent"}
                    description={s.description}
                    tags={s.tags}
                    sourcePath={s.path}
                  />
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* Global */}
          <CollapsibleSection
            title="Global"
            badge={String(globalSkills.length)}
            open={skillsGlobalOpen}
            onToggle={() => setSkillsGlobalOpen((v) => !v)}
          >
            {globalSkills.length === 0 ? (
              <p className="px-1 pb-1 pt-1 text-[10px] text-[var(--text-muted)]">
                No global workspace skills.
              </p>
            ) : (
              <ul className="familiar-tab__rows pt-1">
                {globalSkills.map((s) => (
                  <SkillItem
                    key={s.path}
                    name={s.name}
                    kind={s.kind ?? "agent"}
                    description={s.description}
                    tags={s.tags}
                    sourcePath={s.path}
                  />
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>
      </CapSection>

      </div>{/* end left column */}
      <div className="familiar-tab__col flex min-w-0 flex-col gap-2">

      {/* ── Section 3: Plugins ────────────────────────────────────────────── */}
      <CapSection title="Plugins" scope={`${nonMcpPlugins.length} from runtime`}>
        {nonMcpPlugins.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--border-hairline)] px-3 py-2.5 text-[var(--text-muted)]">
            <p>No plugins in the latest runtime capability scan.</p>
            <CapCta label="Open Capabilities →" onClick={() => navigateMode("capabilities")} />
          </div>
        ) : (
          <div className="familiar-tab__list">
            <ul className="familiar-tab__rows">
              {nonMcpPlugins.map((p) => (
                <li key={p.id} className={`px-3 py-2 ${p.enabled ? "" : "opacity-60"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                    <KindBadge kind={p.kind} />
                    {/* Chip diet: enabled is the expected state — only the
                        exception (disabled) earns a marker. */}
                    {p.enabled ? null : (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        disabled
                      </span>
                    )}
                  </div>
                  {p.command ? (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">{p.command}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CapSection>

      {/* ── Section 4: Runtime ───────────────────────────────────────────── */}
      <CapSection
        title="Runtime"
        scope={
          harnessReport
            ? `${harnessReport.label} ${harnessReport.version ?? ""}`.trim()
            : harnessId
        }
      >
        <ul className="space-y-1">
          <CapRow label="binary" value={harnessReport?.binary ?? "—"} />
          <CapRow label="path" value={harnessReport?.path ?? "—"} mono />
          <CapRow label="version" value={harnessReport?.version ?? "—"} />
          <CapRow label="model" value={familiar.model ?? "—"} />
          {harnessManifest?.scanned_at ? (
            <CapRow label="scanned" value={`${age(harnessManifest.scanned_at)} ago`} />
          ) : null}
        </ul>
      </CapSection>

      {/* ── Section 5: MCP Servers ───────────────────────────────────────── */}
      <CapSection title="MCP Servers" scope={`${mcpPlugins.length} discovered`}>
        {mcpPlugins.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-hairline)] px-3 py-2.5 text-[var(--text-muted)]">
            No MCP servers in the capability scan.
          </p>
        ) : (
          <div className="familiar-tab__list">
            <ul className="familiar-tab__rows">
              {mcpPlugins.map((p) => (
                <li key={p.id} className={`px-3 py-2 ${p.enabled ? "" : "opacity-60"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                    <KindBadge kind="mcp" />
                    {p.enabled ? null : (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        disabled
                      </span>
                    )}
                  </div>
                  {p.command ? (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]" title={[p.command, ...(p.args ?? [])].join(" ")}>
                      {[p.command, ...(p.args ?? [])].join(" ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CapSection>

      {/* ── Section 6: Warnings ─────────────────────────────────────────── */}
      {warnings.length > 0 ? (
        <CapSection title="Warnings" scope={String(warnings.length)}>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 rounded bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
                <div>
                  <span className="font-medium text-[var(--color-warning)]">{w.kind}</span>
                  <p className="text-[10px] text-[var(--text-secondary)]">{w.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </CapSection>
      ) : null}

      </div>{/* end right column */}
      </div>{/* end capability grid */}

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
