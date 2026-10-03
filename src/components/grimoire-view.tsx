"use client";

/**
 * Grimoire — the Cave's dedicated markdown-document surface.
 *
 * One library for every markdown document the coven keeps:
 *
 *   - Stitches — the knowledge vault (~/.coven/knowledge): curated reference
 *     entries sewn from pinned sources or written by hand, edited here (title/tags frontmatter map to the vault schema).
 *   - Memory files — every allow-listed memory root, editable in place with
 *     mtime-guarded saves (agents also write these; conflicts surface, never
 *     silently lose an update).
 * Journal remains a top-level mode rather than a duplicate navigator group.
 *
 * Left: a searchable Library navigator (research missions fold into one
 * group each). Right: open documents as tabs. A document opens in the reader
 * (`grimoire-doc-reader.tsx` — contents rail, reading time, live wiki-links);
 * Edit / E swaps in the shared MdEditor (VISUAL WYSIWYG / MARKDOWN raw) wired
 * to the matching transport, and Done / Esc returns to reading.
 *
 * Deep link: `#grimoire:<kind>:<id>` selects a document on entry.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/lib/icon";
import { MdEditor, type MdEditorSaveResult } from "@/components/md-editor/md-editor";
import { MemoryMdEditor } from "@/components/md-editor/memory-md-editor";
import { JournalEntries } from "@/components/journal/journal-entries";
import "@/styles/journal.css";
import "@/styles/grimoire-launcher.css";
import "@/styles/memory-exploration.css";
import { GrimoireLauncher } from "@/components/grimoire-launcher";
import { GrimoireDocReader, JournalDocReader, MemoryDocReader } from "@/components/grimoire-doc-reader";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import {
  groupMissionStitches,
  journalEntryQuery,
  journalRowFamiliar,
  missionArtifactLabel,
  missionIdOf,
  missionTitleIndex,
  stitchDisplayTitle,
  stitchTagView,
  type StitchNavItem,
} from "@/lib/grimoire-library";
import { copyText } from "@/lib/clipboard";
import type { Familiar } from "@/lib/types";
import { familiarInScope } from "@/lib/familiar-multiselect";
import { parseMdDocument, serializeMdDocument } from "@/lib/md-frontmatter";
import { relativeTime } from "@/lib/relative-time";
import {
  formatDate,
  readDateTimePrefs,
  useDateTimePrefs,
  type DateTimePrefs,
} from "@/lib/datetime-format";
import { SearchInput } from "@/components/ui/search-input";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { invalidateSurfaceResources, readSurfaceResource } from "@/lib/surface-warmup-registry";
import { useAnnouncer } from "@/components/ui/live-region";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemoryFile } from "@/lib/use-memory-file";
import { resolveOutgoingLinks, type WikiDocIndex, type WikiDocRef } from "@/lib/wiki-link-resolve";
import { buildDocGraph, type GraphEdgeType } from "@/lib/grimoire-graph";
import { buildMemoryOwnerIndex, scopeDocGraph } from "@/lib/grimoire-graph-scope";
import { useGrimoireGraphScan } from "@/lib/use-grimoire-graph-scan";
import { knowledgeEntryFlags } from "@/lib/knowledge-flags";
import {
  buildStubPayload,
  groupKnowledgeByCollection,
  knowledgeDocKey,
  knowledgeEntryToRaw,
  rawToKnowledgePayload,
  sameKnowledgeDoc,
  type GrimoireKnowledgeEntry,
  type KnowledgeCollectionSummary,
} from "./grimoire-helpers";
import { StitchIntake, StitchProvenance } from "@/components/stitch-intake";
import type { StitchPinRef } from "@/lib/stitch";
import dynamic from "next/dynamic";
import {
  MAX_OPEN_TABS,
  readGrimoireHash,
  readStoredTabs,
  selectionKey,
  writeGrimoireHash,
  writeStoredTabs,
  type GrimoireSelection,
} from "./grimoire-nav-state";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";

export { MAX_OPEN_TABS } from "./grimoire-nav-state";
export type { GrimoireSelection } from "./grimoire-nav-state";

// The canvas graph is a chunk of physics + drawing code — lazy-load it so the
// cost only lands when the graph is opened.
const GrimoireGraphView = dynamic(
  () => import("@/components/grimoire-graph-view").then((m) => m.GrimoireGraphView),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-0 place-items-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Loading graph…
      </div>
    ),
  },
);

// ── Navigator model ──────────────────────────────────────────────────────────

type KnowledgeEntry = GrimoireKnowledgeEntry & {
  /** Stitch provenance — present when the entry was sewn from pins. */
  pins?: StitchPinRef[];
};

type MemoryEntry = {
  relPath: string;
  fullPath: string;
  modified: string;
  sourceKindLabel: string;
  rootLabel: string;
  familiarId?: string;
};

type JournalSummary = {
  date: string;
  preview: string;
  reflectedBy: string | null;
  modified: string | null;
  /** "familiar" = that familiar's own entry; "legacy" = a coven-wide day file. */
  source?: "familiar" | "legacy";
};

/** The canonical "All familiars" scope — an empty selection filters nothing. */
const EMPTY_FAMILIAR_SCOPE: ReadonlySet<string> = new Set<string>();
/** A stable empty roster, so a bare render keeps callback identities steady. */
const EMPTY_FAMILIARS: Familiar[] = [];

function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  if (collapsed.length <= 46) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 3) return collapsed;
  return `…/${segments.slice(-2).join("/")}`;
}

// ── Open tabs — persisted multi-doc editing ──────────────────────────────────
// Open documents live in a tab strip above the detail pane. Every open tab's
// editor STAYS MOUNTED (inactive ones are display:none), so unsaved drafts
// survive switching tabs. The set (and the active tab) persists to
// localStorage, which doubles as the "recent documents" memory across
// sessions.


// ── Detail editors ───────────────────────────────────────────────────────────

function KnowledgeMdEditor({
  entry,
  onSaved,
  onCancel,
  onDirtyChange,
  visualLifecycleQueueRef,
  onDraftChange,
}: {
  /** null → creating a new entry. */
  entry: KnowledgeEntry | null;
  onSaved: (entry: KnowledgeEntry) => void;
  onCancel?: () => void;
  /** Forwarded to the editor (unsaved-edits indicator on the host tab). */
  onDirtyChange?: (dirty: boolean) => void;
  visualLifecycleQueueRef: MutableRefObject<Promise<void>>;
  onDraftChange?: (raw: string) => void;
}) {
  const initial = useMemo(
    () =>
      entry
        ? knowledgeEntryToRaw(entry)
        : serializeMdDocument({ hasFrontmatter: true, title: null, tags: [], rest: {}, body: "" }),
    [entry],
  );
  const save = useCallback(
    async (raw: string): Promise<MdEditorSaveResult> => {
      const payload = rawToKnowledgePayload(entry?.id ?? null, raw, entry?.collection);
      if (!payload.title && !payload.body) {
        return { ok: false, error: "Add a title or some content first." };
      }
      try {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.ok) return { ok: false, error: json.error ?? "Save failed" };
        onSaved(json.entry as KnowledgeEntry);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
      }
    },
    [entry?.collection, entry?.id, onSaved],
  );
  return (
    <MdEditor
      key={entry ? knowledgeDocKey(entry.id, entry.collection) : "new"}
      value={initial}
      visualLifecycleQueueRef={visualLifecycleQueueRef}
      sourceLabel="Stitches"
      onSave={save}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      onChange={onDraftChange}
      // A new entry materializes on its first (manual) save, which re-keys and
      // remounts this editor; only autosave once it exists so typing isn't
      // interrupted mid-keystroke by that remount.
      autoSave={entry != null}
    />
  );
}

function JournalMdEditor({
  date,
  familiar,
  onSaved,
  onDirtyChange,
  visualLifecycleQueueRef,
}: {
  date: string;
  /** The owning familiar for a per-familiar entry; absent for a legacy day file. */
  familiar?: string;
  onSaved?: () => void;
  /** Forwarded to the editor (unsaved-edits indicator on the host tab). */
  onDirtyChange?: (dirty: boolean) => void;
  visualLifecycleQueueRef: MutableRefObject<Promise<void>>;
}) {
  const dateTimePrefs = useDateTimePrefs();
  const [state, setState] = useState<{ reflection: string; reflectedBy: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The `modified` (mtime) this editor last loaded/saved, sent as the
  // optimistic-concurrency baseline so an autosave can't silently clobber a
  // concurrent generation/edit of the same date. Refreshed from every
  // successful save's response so our own saves never self-conflict.
  const modifiedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    modifiedRef.current = null;
    void (async () => {
      try {
        const res = await fetch(`/api/journal?${journalEntryQuery(date, familiar)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) setError(json.error ?? "Failed to load journal entry");
        else {
          modifiedRef.current = json.modified ?? null;
          setState({
            reflection: json.entry?.reflection ?? "",
            reflectedBy: json.entry?.reflectedBy ?? null,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load journal entry");
      }
    })();
    return () => { cancelled = true; };
  }, [date, familiar]);

  const save = useCallback(
    async (raw: string): Promise<MdEditorSaveResult> => {
      if (!raw.trim()) return { ok: false, error: "Write a reflection before saving." };
      try {
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            reflection: raw,
            // The owner decides which file this writes: a familiar's own
            // entry stays theirs even if it loaded without attribution.
            reflectedBy: state?.reflectedBy ?? familiar ?? null,
            expectedModified: modifiedRef.current,
          }),
        });
        const json = await res.json();
        if (res.status === 409) {
          return { ok: false, error: json.error ?? "This entry changed elsewhere — reload before saving." };
        }
        if (!json.ok) return { ok: false, error: json.error ?? "Save failed" };
        // Advance the baseline so the next autosave compares against what we
        // just wrote, not the now-stale load-time mtime.
        modifiedRef.current = json.modified ?? modifiedRef.current;
        onSaved?.();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
      }
    },
    [date, familiar, onSaved, state?.reflectedBy],
  );

  if (error) return <ErrorState compact headline="Couldn't load this journal entry" subtitle={error} />;
  if (state === null) {
    return (
      <div className="space-y-2.5 p-4" aria-label="Loading journal entry" aria-busy="true">
        {["92%", "85%", "97%"].map((w, i) => (
          <Skeleton key={i} variant="text" width={w} />
        ))}
      </div>
    );
  }
  return (
    <MdEditor
      key={`${familiar ?? ""}:${date}`}
      value={state.reflection}
      visualLifecycleQueueRef={visualLifecycleQueueRef}
      showHeader={false}
      sourceLabel={`Journal · ${journalDayLabel(date, dateTimePrefs)}`}
      onSave={save}
      onDirtyChange={onDirtyChange}
      autoSave
    />
  );
}

// ── Navigator row ────────────────────────────────────────────────────────────

// ── Journal date labels ──────────────────────────────────────────────────────

/** "2026-07-08" → "Jul 8" / "8 Jul" per the user's datetime prefs (+ year when
 *  it isn't the current one). Date-only ISO strings parse as UTC midnight —
 *  anchor to local midnight so the label never shifts a day. */
function journalDayLabel(date: string, prefs: DateTimePrefs): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return formatDate(d, prefs, { year: d.getFullYear() !== new Date().getFullYear() });
}

function NavRow({
  selected,
  title,
  tooltip,
  subtitle,
  tags,
  hint,
  meta,
  badge,
  nested = false,
  onClick,
}: {
  selected: boolean;
  title: string;
  /** Full title on hover when the row truncates it. */
  tooltip?: string;
  /** A mono path-style line (memory rows). */
  subtitle?: string;
  /** Human tags, rendered as quiet `#tag` text (stitch rows). */
  tags?: string[];
  /** A provenance word in front of the tags, e.g. "Research". */
  hint?: string;
  meta?: string;
  badge?: ReactNode;
  /** A child row inside a navigator group (indented, single line). */
  nested?: boolean;
  onClick: () => void;
}) {
  const hasDetail = Boolean(subtitle || tags?.length || hint || meta);
  return (
    <button
      type="button"
      data-rail-item
      onClick={onClick}
      title={tooltip}
      aria-current={selected ? "true" : undefined}
      className={`focus-ring-inset w-full rounded-md text-left transition-colors ${nested ? "px-2 py-1" : "px-2 py-1.5"} ${
        selected
          ? "bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
      }`}
    >
      <span className="flex items-center gap-1">
        <span
          className={`min-w-0 flex-1 truncate font-medium ${
            nested
              ? `text-[length:var(--text-sm)] ${selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`
              : "text-[length:var(--text-sm)] text-[var(--text-primary)]"
          }`}
        >
          {title}
        </span>
        {badge}
        {nested && meta ? (
          <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{meta}</span>
        ) : null}
      </span>
      {!nested && hasDetail ? (
        <span className="mt-0.5 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {hint ? (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Icon name="ph:flask" width={11} aria-hidden />
              {hint}
            </span>
          ) : null}
          {subtitle ? <span className="min-w-0 truncate font-mono">{subtitle}</span> : null}
          {tags?.length ? (
            <span className="grimoire-nav-tags min-w-0 truncate">
              {tags.map((tag) => (
                <span key={tag} className="grimoire-nav-tag">#{tag}</span>
              ))}
            </span>
          ) : null}
          {meta ? <span className="ml-auto shrink-0">{meta}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

// ── Navigator section (collapsible) ──────────────────────────────────────────

const RAIL_COLLAPSED_STORAGE_KEY = "cave:grimoire:rail-collapsed";
const NAVIGATOR_COLLAPSED_STORAGE_KEY = "cave:grimoire:navigator-collapsed:v1";

type RailSectionId = "knowledge" | "memory";

const MEMORY_GROUPS_STORAGE_KEY = "cave:grimoire:memory-groups-collapsed";
const STITCH_GROUPS_STORAGE_KEY = "cave:grimoire:stitch-groups-collapsed";
/** Research-mission groups start folded; this records the ones a person opened
 *  (or explicitly closed while reading inside them). */
const MISSION_GROUPS_STORAGE_KEY = "cave:grimoire:mission-groups-expanded";

function readCollapsedRecord(storageKey: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Per-root collapse overrides for the Memory section's source groups. */
function readCollapsedMemoryGroups(): Record<string, boolean> {
  return readCollapsedRecord(MEMORY_GROUPS_STORAGE_KEY);
}

function readCollapsedStitchGroups(): Record<string, boolean> {
  return readCollapsedRecord(STITCH_GROUPS_STORAGE_KEY);
}

function readExpandedMissionGroups(): Record<string, boolean> {
  return readCollapsedRecord(MISSION_GROUPS_STORAGE_KEY);
}

function readCollapsedSections(): Record<RailSectionId, boolean> {
  const none = { knowledge: false, memory: false };
  if (typeof window === "undefined") return none;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) ?? "{}");
    return {
      knowledge: parsed?.knowledge === true,
      memory: parsed?.memory === true,
    };
  } catch {
    return none;
  }
}

function readNavigatorCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAVIGATOR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** One navigator source group: a collapsible header (kind icon + count) over
 *  its rows. An active search overrides collapse — matches must be reachable. */
function RailSection({
  ariaLabel,
  icon,
  label,
  description,
  count,
  collapsed,
  onToggle,
  children,
}: {
  ariaLabel: string;
  icon: IconName;
  label: string;
  /** One line saying what belongs in this source — the three sources read as
   *  synonyms to a new user, so each header explains its own. */
  description: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel}>
      <h3>
        <button
          type="button"
          data-rail-item
          aria-expanded={!collapsed}
          title={description}
          onClick={onToggle}
          className="focus-ring-inset flex w-full items-center gap-1.5 rounded-md px-2 pb-1 pt-0.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          <Icon name={collapsed ? "ph:caret-right" : "ph:caret-down"} width={9} aria-hidden />
          <Icon name={icon} width={11} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <span className="shrink-0 font-normal">{count}</span>
        </button>
      </h3>
      {collapsed ? null : children}
    </section>
  );
}

// ── Wiki-link chips ──────────────────────────────────────────────────────────

/** A doc referencing the open one — Obsidian's linked/unlinked mentions,
 *  derived from the doc graph (full-corpus scan when available). */
export type GrimoireBacklink = { ref: WikiDocRef; title: string; type: GraphEdgeType };

/** The open doc's connections, shown as chip rows below the editor: its
 *  outgoing [[wiki-links]] (resolved chips navigate; unresolved ones render
 *  dashed + inert) and its incoming mentions from the doc graph. Mounted only
 *  for the active doc, so exactly one doc's content is read at a time. */
function GrimoireDocLinks({
  selection,
  liveMarkdown,
  knowledge,
  collections,
  docIndex,
  backlinks,
  onOpen,
  onCreated,
}: {
  selection: GrimoireSelection;
  /** The active editor's unsaved text; backlinks still come from the persisted graph. */
  liveMarkdown?: string;
  knowledge: KnowledgeEntry[];
  collections: KnowledgeCollectionSummary[];
  docIndex: WikiDocIndex;
  backlinks: GrimoireBacklink[];
  onOpen: (sel: GrimoireSelection) => void;
  onCreated: () => void;
}) {
  // useMemoryFile is a hook, so it's always called; a null path is a no-op.
  const memoryPath = selection.kind === "memory" ? selection.path : null;
  const memFile = useMemoryFile(memoryPath, { reveal: true });
  const { announce } = useAnnouncer();
  // (grimoire-audit cave-bkpj) Unresolved chips explained themselves via
  // title= only — inert on touch. Tapping one now shows (and announces) why.
  const [unresolvedHint, setUnresolvedHint] = useState<string | null>(null);
  useEffect(() => setUnresolvedHint(null), [selection]);

  const [journalMd, setJournalMd] = useState<string | null>(null);
  useEffect(() => {
    if (selection.kind !== "journal") {
      setJournalMd(null);
      return;
    }
    let cancelled = false;
    setJournalMd(null);
    void (async () => {
      try {
        const res = await fetch(`/api/journal?${journalEntryQuery(selection.date, selection.familiar)}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setJournalMd(json.ok ? (json.entry?.reflection ?? "") : "");
      } catch {
        if (!cancelled) setJournalMd("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const markdown =
    selection.kind === "knowledge"
      ? liveMarkdown ?? knowledge.find((k) => sameKnowledgeDoc(k, selection))?.body ?? ""
      : selection.kind === "memory"
        ? memFile.text ?? ""
        : selection.kind === "journal"
          ? journalMd ?? ""
          : "";
  const sourceTitle =
    selection.kind === "knowledge"
      ? knowledge.find((k) => sameKnowledgeDoc(k, selection))?.title ?? selection.id
      : selection.kind === "memory"
        ? (selection.path.split("/").pop() ?? selection.path).replace(/\.(md|markdown)$/i, "")
        : selection.kind === "journal"
          ? selection.date
          : "this document";

  const stubCollections = useMemo(() => collections.filter((c) => c.meta).slice(0, 5), [collections]);
  const createStub = useCallback(
    async (display: string, collection: KnowledgeCollectionSummary | null) => {
      try {
        const payload = buildStubPayload(display, collection, sourceTitle);
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.ok) {
          announce(json.error ?? "Couldn't create stitch", "polite");
          return;
        }
        const entry = json.entry as KnowledgeEntry;
        onCreated();
        announce(`Created stitch ${entry.title}`, "polite");
        onOpen({ kind: "knowledge", id: entry.id, ...(entry.collection ? { collection: entry.collection } : {}) });
      } catch (err) {
        announce(err instanceof Error ? err.message : "Couldn't create stitch", "polite");
      }
    },
    [announce, onCreated, onOpen, sourceTitle],
  );

  const links = useMemo(() => {
    const seen = new Set<string>();
    const out: ReturnType<typeof resolveOutgoingLinks> = [];
    for (const link of resolveOutgoingLinks(markdown, docIndex)) {
      const key = link.target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
    return out;
  }, [markdown, docIndex]);

  if (links.length === 0 && backlinks.length === 0) {
    return null;
  }

  return (
    <div className="grimoire-doc-links shrink-0 space-y-1.5 border-t border-[var(--border-hairline)] px-3 py-2">
      {links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[length:var(--text-2xs)] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            <Icon name="ph:link" width={11} aria-hidden />
            Links
          </span>
          {links.map((link, i) => {
            const { ref, display } = link;
            return ref ? (
              <button
                key={i}
                type="button"
                onClick={() => onOpen(ref)}
                className="focus-ring rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_50%,var(--border-hairline))] hover:text-[var(--text-primary)]"
              >
                {display}
              </button>
            ) : (
              <button
                key={i}
                type="button"
                title="No matching Memories doc"
                aria-expanded={unresolvedHint === display}
                onClick={() => {
                  const hint = `“${display}” has no matching doc yet — create a stitch with that title to link it.`;
                  setUnresolvedHint((prev) => (prev === display ? null : display));
                  if (unresolvedHint !== display) announce(hint, "polite");
                }}
                className="focus-ring rounded-full border border-dashed border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              >
                {display}
              </button>
            );
          })}
        </div>
      ) : null}
      {unresolvedHint ? (
        <div className="space-y-1" role="status">
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            “{unresolvedHint}” has no matching doc yet — create a stitch with that title to
            link it.
          </p>
          <div className="flex flex-wrap gap-1">
            {(stubCollections.length > 0 ? stubCollections : [null]).map((collection) => (
              <button
                key={collection?.id ?? "root"}
                type="button"
                onClick={() => void createStub(unresolvedHint, collection)}
                className="focus-ring rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_50%,var(--border-hairline))] hover:text-[var(--text-primary)]"
              >
                {collection ? `Create in ${collection.meta?.name ?? collection.id}` : "Create stitch"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {backlinks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[length:var(--text-2xs)] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            <Icon name="ph:graph" width={11} aria-hidden />
            Mentions
          </span>
          {backlinks.map((b, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onOpen(b.ref)}
              title={b.type === "mention" ? "Mentions this doc (unlinked)" : "Links to this doc"}
              className={`focus-ring rounded-full border px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_50%,var(--border-hairline))] hover:text-[var(--text-primary)] ${
                b.type === "mention" ? "border-dashed border-[var(--border-hairline)]" : "border-[var(--border-hairline)]"
              }`}
            >
              {b.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Surface ──────────────────────────────────────────────────────────────────

export type GrimoireViewKind = "docs" | "graph" | "journal";

function invalidateGrimoireLanding(): void {
  invalidateSurfaceResources("grimoire:knowledge", "grimoire:collections", "memory:list", "grimoire:journal");
}

export function GrimoireView({
  view: controlledView,
  onViewChange,
  familiars = EMPTY_FAMILIARS,
  activeFamiliarId = null,
  scopeFamiliarIds,
}: {
  /** Which tab shows. Controlled by the Workspace so the Journal nav row can
   *  route straight into the Journal tab; falls back to internal state when the
   *  view is rendered bare (tests). */
  view?: GrimoireViewKind;
  onViewChange?: (view: GrimoireViewKind) => void;
  /** Roster for the Journal tab (reflection filter + attribution). */
  familiars?: Familiar[];
  activeFamiliarId?: string | null;
  /** The shell's familiar multiselect. Empty = All. When familiars are
   *  selected, the Memory navigator shows only those familiars' own memory —
   *  ownerless shared pools drop out, matching the app-wide familiar-memory
   *  rule documented in `@/lib/memory-file-scope`. */
  scopeFamiliarIds?: ReadonlySet<string>;
} = {}) {
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[] | null>(null);
  const [collections, setCollections] = useState<KnowledgeCollectionSummary[] | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[] | null>(null);
  const [journal, setJournal] = useState<JournalSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [internalView, setInternalView] = useState<GrimoireViewKind>("docs");
  const view = controlledView ?? internalView;
  const setView = useCallback(
    (next: GrimoireViewKind) => {
      onViewChange?.(next);
      if (controlledView === undefined) setInternalView(next);
    },
    [controlledView, onViewChange],
  );
  const [localFamiliarId, setLocalFamiliarId] = useState("");
  const shellScope = scopeFamiliarIds ?? EMPTY_FAMILIAR_SCOPE;
  // A page filter may narrow the shell scope, never silently widen it.
  const selectedFamiliarId = localFamiliarId && familiars.some((f) => f.id === localFamiliarId) && (shellScope.size === 0 || shellScope.has(localFamiliarId))
    ? localFamiliarId : "";
  const memoryScope = useMemo(
    () => selectedFamiliarId ? new Set([selectedFamiliarId]) : shellScope,
    [selectedFamiliarId, shellScope],
  );
  const { scan, scanning, scanError, refreshGraph } = useGrimoireGraphScan(memoryScope);
  const [collapsedSections, setCollapsedSections] = useState<Record<RailSectionId, boolean>>(
    readCollapsedSections,
  );
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(readNavigatorCollapsed);
  const firstLoadDoneRef = useRef(false);
  const toggleSection = useCallback((id: RailSectionId) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — collapse stays session-only */
      }
      return next;
    });
  }, []);
  const confirm = useConfirm();
  /** A familiar's display name for journal labels (falls back to its id). */
  const familiarLabel = useCallback(
    (id: string) => familiars.find((f) => f.id === id)?.display_name ?? id,
    [familiars],
  );
  const { announce } = useAnnouncer();
  const setNavigatorCollapsedPreference = useCallback(
    (next: boolean) => {
      setNavigatorCollapsed(next);
      try {
        window.localStorage.setItem(NAVIGATOR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        /* private mode — collapse stays session-only */
      }
      announce(next ? "Memories sidebar collapsed" : "Memories sidebar expanded", "polite");
    },
    [announce],
  );
  const toggleNavigator = useCallback(
    () => setNavigatorCollapsedPreference(!navigatorCollapsed),
    [navigatorCollapsed, setNavigatorCollapsedPreference],
  );
  const revealNavigatorSection = useCallback(
    (id: RailSectionId) => {
      setNavigatorCollapsedPreference(false);
      setCollapsedSections((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev, [id]: false };
        try {
          window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* private mode — collapse stays session-only */
        }
        return next;
      });
    },
    [setNavigatorCollapsedPreference],
  );
  const dateTimePrefs = useDateTimePrefs();
  // Selection evicted by an over-cap openDoc, announced post-commit.
  const evictedRef = useRef<GrimoireSelection | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Reader-first documents: every persisted doc opens in the reader, and
  // editing is an explicit per-tab step (Edit / E) that Done or Esc ends. An
  // editor holding unsaved changes stays mounted (hidden) while its tab reads,
  // so a draft survives the trip back to reading.
  const [editingTabs, setEditingTabs] = useState<Record<string, true>>({});
  // Bumped after a save so that tab's reader re-reads what was written.
  const [readerRefresh, setReaderRefresh] = useState<Record<string, number>>({});
  // Asks one tab's reader to take keyboard focus once it renders.
  const [readerFocusRequest, setReaderFocusRequest] = useState<{ key: string; n: number } | null>(null);
  // Focus reading: the active document alone, without the surface chrome.
  const [focusMode, setFocusMode] = useState(false);
  const docModeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreDocModeFocusRef = useRef(false);
  // Open tabs + the active one. A #grimoire: deep link wins over the restored
  // active tab and is merged into the restored tab set.
  const [storedSelectionKey, setStoredSelectionKey, preferencesHydrated] = useSurfacePreference(surfacePreferenceSpecs.grimoire.selected);
  // The hash is a one-visit route target. Keep it separate from the durable
  // preference so a linked document never replaces the person's return tab.
  const deepLinkActiveRef = useRef(false);
  const preferenceRestoreAppliedRef = useRef(false);
  const restoredSelectionPendingRef = useRef(false);
  const [{ openTabs, selection }, setTabState] = useState<{
    openTabs: GrimoireSelection[];
    selection: GrimoireSelection | null;
  }>(() => {
    const stored = readStoredTabs();
    const fromHash = readGrimoireHash();
    if (fromHash) {
      deepLinkActiveRef.current = true;
      const key = selectionKey(fromHash);
      const tabs = stored.tabs.some((t) => selectionKey(t) === key)
        ? stored.tabs
        : [...stored.tabs, fromHash].slice(-MAX_OPEN_TABS);
      return { openTabs: tabs, selection: fromHash };
    }
    const active = stored.activeKey
      ? stored.tabs.find((t) => selectionKey(t) === stored.activeKey) ?? null
      : null;
    return { openTabs: stored.tabs, selection: active };
  });
  const selectedKey = selection ? selectionKey(selection) : null;
  const openTabKeys = useMemo(() => new Set(openTabs.map(selectionKey)), [openTabs]);
  const openTabKeysRef = useRef(openTabKeys);
  openTabKeysRef.current = openTabKeys;
  // One queue per persistent tab: editors in separate tabs may coexist, while
  // a given tab's Crepe teardown must finish before any replacement mounts.
  const visualLifecycleQueuesRef = useRef(
    new Map<string, MutableRefObject<Promise<void>>>(),
  );
  const visualLifecycleQueueFor = useCallback((key: string) => {
    const existing = visualLifecycleQueuesRef.current.get(key);
    if (existing) return existing;
    const queue = { current: Promise.resolve() };
    visualLifecycleQueuesRef.current.set(key, queue);
    return queue;
  }, []);

  useEffect(() => {
    for (const [key, queue] of visualLifecycleQueuesRef.current) {
      if (openTabKeysRef.current.has(key)) continue;
      const releaseWhenSettled = () => {
        const pending = queue.current;
        const release = () => {
          if (openTabKeysRef.current.has(key)) return;
          if (visualLifecycleQueuesRef.current.get(key) !== queue) return;
          // An unmount may extend the mutable queue after this effect observed
          // it. Follow that newer teardown instead of releasing early.
          if (queue.current !== pending) {
            releaseWhenSettled();
            return;
          }
          visualLifecycleQueuesRef.current.delete(key);
        };
        void pending.then(release, release);
      };
      releaseWhenSettled();
    }
  }, [openTabKeys]);

  useEffect(() => {
    if (!preferencesHydrated || deepLinkActiveRef.current || preferenceRestoreAppliedRef.current) return;
    preferenceRestoreAppliedRef.current = true;
    if (!storedSelectionKey) return;
    setTabState((current) => {
      const restored = current.openTabs.find((tab) => selectionKey(tab) === storedSelectionKey) ?? null;
      if (!restored || (current.selection && selectionKey(current.selection) === selectionKey(restored))) return current;
      restoredSelectionPendingRef.current = true;
      return { ...current, selection: restored };
    });
  }, [preferencesHydrated, storedSelectionKey]);

  /** Open (or focus) a document tab. */
  // (grimoire-audit cave-vv2h) Per-tab unsaved-edits flags, reported by each
  // editor via onDirtyChange — they drive the tab dot and the close confirm.
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setKnowledgeDrafts((previous) => {
      const staleKeys = Object.keys(previous).filter((key) => !openTabKeys.has(key));
      if (staleKeys.length === 0) return previous;
      const next = { ...previous };
      for (const key of staleKeys) delete next[key];
      return next;
    });
  }, [openTabKeys]);
  const setTabDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyTabs((prev) => {
      if (!!prev[key] === dirty) return prev;
      const next = { ...prev };
      if (dirty) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  const openDoc = useCallback((sel: GrimoireSelection) => {
    setTabState((prev) => {
      const key = selectionKey(sel);
      if (prev.openTabs.some((t) => selectionKey(t) === key)) {
        return { openTabs: prev.openTabs, selection: sel };
      }
      let tabs = [...prev.openTabs, sel];
      if (tabs.length > MAX_OPEN_TABS) {
        // Evict the oldest non-active tab to stay within the mount budget.
        const activeKey = prev.selection ? selectionKey(prev.selection) : null;
        const evictIndex = tabs.findIndex((t) => selectionKey(t) !== activeKey);
        evictedRef.current = tabs[evictIndex] ?? null;
        tabs = tabs.filter((_, i) => i !== evictIndex);
      }
      return { openTabs: tabs, selection: sel };
    });
  }, []);

  // Launcher-driven stitch prefill (URL capture / template row): bumping the
  // nonce re-keys the StitchIntake mount so its mount-time initial state takes.
  // Plain "New stitch" opens never bump it — refocusing the open intake must
  // not blow away pinned sources.
  const [stitchPrefill, setStitchPrefill] = useState<{
    nonce: number;
    patternId?: string;
    pinUrl?: string;
  }>({ nonce: 0 });
  const openStitchNew = useCallback(
    (opts?: { patternId?: string; pinUrl?: string }) => {
      if (opts?.patternId || opts?.pinUrl) {
        setStitchPrefill((prev) => ({
          nonce: prev.nonce + 1,
          ...(opts.patternId ? { patternId: opts.patternId } : {}),
          ...(opts.pinUrl ? { pinUrl: opts.pinUrl } : {}),
        }));
      } else {
        // Plain opens keep the nonce (an already-open intake must not remount
        // and lose pinned sources) but drop any stale prefill so the next
        // fresh mount starts blank instead of replaying an old capture.
        setStitchPrefill((prev) => (prev.patternId || prev.pinUrl ? { nonce: prev.nonce } : prev));
      }
      openDoc({ kind: "stitch-new" });
    },
    [openDoc],
  );

  const closeTab = useCallback((key: string) => {
    setDirtyTabs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setEditingTabs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setTabState((prev) => {
      const index = prev.openTabs.findIndex((t) => selectionKey(t) === key);
      if (index < 0) return prev;
      const tabs = prev.openTabs.filter((_, i) => i !== index);
      let selection = prev.selection;
      if (selection && selectionKey(selection) === key) {
        selection = tabs[Math.min(index, tabs.length - 1)] ?? null;
      }
      return { openTabs: tabs, selection };
    });
  }, []);

  /** Close from the tab strip: a tab with unsaved edits confirms first. */
  const requestCloseTab = useCallback(
    async (key: string, title: string) => {
      if (dirtyTabs[key]) {
        const ok = await confirm({
          title: `Close ${title}?`,
          body: "It has unsaved changes that will be lost.",
          confirmLabel: "Close tab",
          danger: true,
        });
        if (!ok) return;
      }
      closeTab(key);
    },
    [dirtyTabs, confirm, closeTab],
  );

  /** Swap one tab for another in place (e.g. a saved draft gaining its id). */
  const replaceTab = useCallback((fromKey: string, next: GrimoireSelection) => {
    const nextKey = selectionKey(next);
    // A blank entry's first save keeps writing; a sewn stitch opens to read.
    setEditingTabs((previous) => {
      const wasEditing = fromKey === "knowledge-new" || previous[fromKey] === true;
      if (!wasEditing && !(fromKey in previous)) return previous;
      const updated = { ...previous };
      delete updated[fromKey];
      if (wasEditing) updated[nextKey] = true;
      return updated;
    });
    const queue = visualLifecycleQueuesRef.current.get(fromKey);
    if (queue && !visualLifecycleQueuesRef.current.has(nextKey)) {
      visualLifecycleQueuesRef.current.set(nextKey, queue);
    }
    setKnowledgeDrafts((previous) => {
      if (!Object.hasOwn(previous, fromKey)) return previous;
      const draft = previous[fromKey];
      const updated = { ...previous, [nextKey]: draft };
      if (fromKey !== nextKey) delete updated[fromKey];
      return updated;
    });
    setTabState((prev) => {
      let tabs = prev.openTabs.map((t) => (selectionKey(t) === fromKey ? next : t));
      // De-dupe if the target already had a tab.
      tabs = tabs.filter((t, i) => tabs.findIndex((o) => selectionKey(o) === selectionKey(t)) === i);
      const selection =
        prev.selection && selectionKey(prev.selection) === fromKey ? next : prev.selection;
      return { openTabs: tabs, selection };
    });
  }, []);

  useEffect(() => {
    writeStoredTabs(openTabs, selection ? selectionKey(selection) : null);
    if (!preferencesHydrated) return;
    // The initial hash target is intentionally one-visit only. Once hydration
    // has had its chance to keep that target ahead of the saved return tab,
    // release the guard so a later user selection becomes the new preference.
    if (deepLinkActiveRef.current) {
      deepLinkActiveRef.current = false;
      return;
    }
    if (restoredSelectionPendingRef.current) {
      if ((selection ? selectionKey(selection) : null) !== storedSelectionKey) return;
      restoredSelectionPendingRef.current = false;
    }
    setStoredSelectionKey(selection ? selectionKey(selection) : null);
  }, [openTabs, preferencesHydrated, selection, setStoredSelectionKey, storedSelectionKey]);

  const load = useCallback(async (force = false) => {
    setLoadError(null);
    // The doc graph is derived from the same corpus — refresh it whenever the
    // lists refresh after a save/delete (the scan hook already fetched on
    // mount; server-side content caching keeps rescans cheap).
    if (firstLoadDoneRef.current) refreshGraph();
    firstLoadDoneRef.current = true;
    try {
      const [kResult, cResult, mResult, jResult] = await Promise.all([
        readSurfaceResource<{ ok?: boolean; entries?: GrimoireKnowledgeEntry[] }>("grimoire:knowledge", force),
        readSurfaceResource<{ ok?: boolean; collections?: KnowledgeCollectionSummary[] }>("grimoire:collections", force),
        readSurfaceResource<{ ok?: boolean; entries?: MemoryEntry[] }>("memory:list", force),
        readSurfaceResource<{ ok?: boolean; days?: JournalSummary[] }>("grimoire:journal", force),
      ]);
      const [k, c, m, j] = [kResult.data, cResult.data, mResult.data, jResult.data];
      setKnowledge(k.ok && Array.isArray(k.entries) ? k.entries : []);
      setCollections(c.ok && Array.isArray(c.collections) ? c.collections : []);
      setMemory(m.ok && Array.isArray(m.entries) ? m.entries : []);
      setJournal(j.ok && Array.isArray(j.days) ? j.days : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load documents");
    }
  }, [refreshGraph]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    writeGrimoireHash(selection);
  }, [selection]);

  // Reset any stale delete feedback when the selection changes.
  useEffect(() => {
    setDeleteError(null);
  }, [selection]);

  const selectedKnowledgeEntry =
    selection?.kind === "knowledge"
      ? (knowledge ?? []).find((entry) => sameKnowledgeDoc(entry, selection)) ?? null
      : null;
  // A loaded, persisted document — the reader, Edit/Done, focus reading, and
  // delete all act on one of these (never on an unsaved draft or the intake).
  const readerEligible =
    view === "docs" &&
    selection !== null &&
    selection.kind !== "knowledge-new" &&
    selection.kind !== "stitch-new" &&
    (selection.kind !== "knowledge" || selectedKnowledgeEntry !== null);
  const isTabEditing = useCallback(
    (tab: GrimoireSelection) => tab.kind === "knowledge-new" || editingTabs[selectionKey(tab)] === true,
    [editingTabs],
  );
  const selectedEditing = selection !== null && isTabEditing(selection);
  const focusEligible = readerEligible && !selectedEditing;

  const requestReaderFocus = useCallback((key: string) => {
    setReaderFocusRequest((prev) => ({ key, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // Asks a tab's editor to take keyboard focus once its (lazily loaded)
  // editing surface mounts, so typing and Esc work straight after Edit / E.
  const [editorFocusRequest, setEditorFocusRequest] = useState<{ key: string; n: number } | null>(null);
  const startEditing = useCallback(
    (key: string) => {
      setFocusMode(false);
      setEditingTabs((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
      setEditorFocusRequest((prev) => ({ key, n: (prev?.n ?? 0) + 1 }));
      announce("Editing", "polite");
    },
    [announce],
  );
  useEffect(() => {
    if (!editorFocusRequest) return;
    const host = document.querySelector<HTMLElement>(
      `[data-grimoire-editor="${CSS.escape(editorFocusRequest.key)}"]`,
    );
    if (!host) return;
    const focusSurface = () => {
      const target = host.querySelector<HTMLElement>(".ProseMirror[contenteditable='true'], .cm-content");
      if (!target) return false;
      target.focus({ preventScroll: true });
      return true;
    };
    if (focusSurface()) return;
    // The visual editor loads lazily; watch for its surface to appear.
    const observer = new MutationObserver(() => {
      if (focusSurface()) observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
    // No surface (a load error): still give Esc a place to land, unless the
    // person has already moved focus somewhere themselves.
    const fallback = window.setTimeout(() => {
      observer.disconnect();
      if (document.activeElement === document.body) host.focus({ preventScroll: true });
    }, 3000);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, [editorFocusRequest]);

  /** Back to reading. An unsaved draft is kept: its editor stays mounted and
   *  the reader offers to resume (memory files never autosave). */
  const stopEditing = useCallback(
    (key: string) => {
      setEditingTabs((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      requestReaderFocus(key);
      announce("Reading", "polite");
    },
    [announce, requestReaderFocus],
  );

  const bumpReader = useCallback((key: string) => {
    setReaderRefresh((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!focusEligible && focusMode) setFocusMode(false);
  }, [focusEligible, focusMode]);

  const leaveFocus = useCallback(() => {
    restoreDocModeFocusRef.current = true;
    setFocusMode(false);
  }, []);

  // Entering focus reading (or following a link inside it) hands the keyboard
  // to the document so arrow keys scroll and E edits.
  useEffect(() => {
    if (focusMode && selectedKey) requestReaderFocus(selectedKey);
  }, [focusMode, requestReaderFocus, selectedKey]);

  useEffect(() => {
    if (focusMode || !restoreDocModeFocusRef.current) return;
    restoreDocModeFocusRef.current = false;
    docModeTriggerRef.current?.focus();
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const exitFocus = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      leaveFocus();
    };
    window.addEventListener("keydown", exitFocus);
    return () => window.removeEventListener("keydown", exitFocus);
  }, [leaveFocus, focusMode]);

  // Esc with nothing focused (a click on dead space) still ends editing.
  useEffect(() => {
    if (!selectedEditing || !selectedKey || selection?.kind === "knowledge-new" || view !== "docs") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.target !== document.body) return;
      event.preventDefault();
      stopEditing(selectedKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEditing, selectedKey, selection?.kind, stopEditing, view]);

  /** Esc inside an editor returns to reading — unless the visual editor is
   *  using Esc itself to dismiss its slash menu or a link/format popover. */
  const onEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, tab: GrimoireSelection) => {
      if (event.key !== "Escape" || event.defaultPrevented || tab.kind === "knowledge-new") return;
      if (
        document.querySelector(
          '.milkdown-slash-menu[data-show="true"], .milkdown-link-edit[data-show="true"], .milkdown-latex-inline-edit[data-show="true"], .milkdown-toolbar[data-show="true"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      stopEditing(selectionKey(tab));
    },
    [stopEditing],
  );

  /** Copy the open document's markdown — the live draft when one is open,
   *  otherwise what is saved. */
  const copySelectionMarkdown = useCallback(async () => {
    if (!selection || selection.kind === "knowledge-new" || selection.kind === "stitch-new") return;
    const key = selectionKey(selection);
    let text: string | null = null;
    try {
      if (selection.kind === "knowledge") {
        const entry = (knowledge ?? []).find((e) => sameKnowledgeDoc(e, selection));
        text = knowledgeDrafts[key] ?? (entry ? knowledgeEntryToRaw(entry) : null);
      } else {
        const url =
          selection.kind === "memory"
            ? `/api/memory/file?path=${encodeURIComponent(selection.path)}`
            : `/api/journal?${journalEntryQuery(selection.date, selection.familiar)}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (json.ok) text = selection.kind === "memory" ? json.text ?? "" : json.entry?.reflection ?? "";
      }
    } catch {
      text = null;
    }
    const ok = text !== null && (await copyText(text));
    announce(ok ? "Markdown copied" : "Couldn't copy this document", ok ? "polite" : "assertive");
  }, [announce, knowledge, knowledgeDrafts, selection]);

  // Delete/trash the selected document. Memory files archive to the memory
  // trash (restorable via POST /api/memory/restore); knowledge entries and
  // journal reflections delete through their APIs.
  const deleteSelection = useCallback(async () => {
    if (!selection || selection.kind === "knowledge-new" || selection.kind === "stitch-new" || deleting) return;
    const label =
      selection.kind === "memory"
        ? "Move this memory file to the trash?"
        : selection.kind === "knowledge"
          ? "Delete this stitch?"
          : `Delete ${selection.familiar ? `${familiarLabel(selection.familiar)}'s` : "the"} journal reflection for ${journalDayLabel(selection.date, readDateTimePrefs())}?`;
    const body =
      selection.kind === "memory"
        ? "The file moves to the Cave's memory trash and can be restored from there."
        : "This can't be undone.";
    if (!(await confirm({ title: label, body, confirmLabel: selection.kind === "memory" ? "Move to trash" : "Delete", danger: true }))) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res =
        selection.kind === "memory"
          ? await fetch("/api/memory/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: selection.path }),
            })
          : selection.kind === "knowledge"
            ? await fetch(
                `/api/knowledge?id=${encodeURIComponent(selection.id)}${
                  selection.collection ? `&collection=${encodeURIComponent(selection.collection)}` : ""
                }`,
                { method: "DELETE" },
              )
            : await fetch(`/api/journal?${journalEntryQuery(selection.date, selection.familiar)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        setDeleteError(json.error ?? "Delete failed");
        return;
      }
      // A deleted document's tab closes with it.
      closeTab(selectionKey(selection));
      invalidateGrimoireLanding();
      void load(true);
      // The row disappearing is the only visual confirmation — say it too.
      announce(
        selection.kind === "memory"
          ? "Memory file moved to trash"
          : selection.kind === "knowledge"
            ? "Stitch deleted"
            : `Journal reflection for ${selection.date} deleted`,
      );
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [announce, closeTab, confirm, deleting, load, selection]);

  const q = query.trim().toLowerCase();
  // Search results must stay reachable even when the persisted rail preference
  // is compact. Clearing the query restores that preference without a write.
  const navigatorCollapsedForDisplay = navigatorCollapsed && !q;
  const matches = useCallback(
    (...fields: Array<string | undefined | null>) =>
      !q || fields.some((f) => f && f.toLowerCase().includes(q)),
    [q],
  );

  // Research missions publish several artifacts under one question; the
  // mission's human title names its navigator group, disambiguates its tabs
  // ("Findings · …"), and makes every artifact findable by that question.
  const missionTitles = useMemo(() => missionTitleIndex(knowledge ?? []), [knowledge]);
  const visibleKnowledge = useMemo(
    () =>
      (knowledge ?? []).filter((e) => {
        const missionId = missionIdOf(e.tags);
        return matches(e.title, e.id, e.collection, e.tags.join(" "), missionId ? missionTitles.get(missionId) : null);
      }),
    [knowledge, matches, missionTitles],
  );
  const knowledgeGroups = useMemo(
    () => groupKnowledgeByCollection(visibleKnowledge, collections ?? []),
    [visibleKnowledge, collections],
  );
  const [collapsedStitchGroups, setCollapsedStitchGroups] =
    useState<Record<string, boolean>>(readCollapsedStitchGroups);
  const toggleStitchGroup = useCallback((id: string) => {
    setCollapsedStitchGroups((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? false) };
      try {
        window.localStorage.setItem(STITCH_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — session-only */
      }
      return next;
    });
  }, []);
  const [expandedMissionGroups, setExpandedMissionGroups] =
    useState<Record<string, boolean>>(readExpandedMissionGroups);
  const toggleMissionGroup = useCallback((missionId: string, expanded: boolean) => {
    setExpandedMissionGroups((prev) => {
      const next = { ...prev, [missionId]: !expanded };
      try {
        window.localStorage.setItem(MISSION_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — session-only */
      }
      return next;
    });
  }, []);
  // The shell's familiar multiselect scopes the Memory navigator: an empty
  // selection is "All", otherwise only the selected familiars' own memory
  // files survive (ownerless shared pools are another familiar's business).
  const memoryScoped = memoryScope.size > 0;
  /** Who the Memory section is currently narrowed to, for scoped empty copy. */
  const memoryScopeLabel = useMemo(() => {
    if (memoryScope.size === 0) return null;
    if (memoryScope.size > 2) return `the ${memoryScope.size} selected familiars`;
    return [...memoryScope]
      .map((id) => familiars.find((f) => f.id === id)?.display_name ?? id)
      .join(" and ");
  }, [familiars, memoryScope]);
  const scopedMemory = useMemo(
    () => (memory ?? []).filter((e) => familiarInScope(memoryScope, e.familiarId)),
    [memory, memoryScope],
  );
  const visibleMemory = useMemo(
    () => scopedMemory.filter((e) => matches(e.relPath, e.fullPath, e.rootLabel, e.familiarId)),
    [scopedMemory, matches],
  );
  // Runtime roots write thousands of timestamp-named session files; rendered
  // flat they drown Stitches and Journal. Group memory by its source root —
  // big groups start collapsed, and an active search expands everything so
  // matches stay reachable.
  const memoryGroups = useMemo(() => {
    const order: string[] = [];
    const byRoot = new Map<string, MemoryEntry[]>();
    for (const entry of visibleMemory) {
      let group = byRoot.get(entry.rootLabel);
      if (!group) {
        group = [];
        byRoot.set(entry.rootLabel, group);
        order.push(entry.rootLabel);
      }
      group.push(entry);
    }
    return order.map((label) => ({ label, entries: byRoot.get(label)! }));
  }, [visibleMemory]);
  const [collapsedMemoryGroups, setCollapsedMemoryGroups] =
    useState<Record<string, boolean>>(readCollapsedMemoryGroups);
  const toggleMemoryGroup = useCallback((label: string, defaultCollapsed: boolean) => {
    setCollapsedMemoryGroups((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? defaultCollapsed) };
      try {
        window.localStorage.setItem(MEMORY_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — session-only */
      }
      return next;
    });
  }, []);
  // Big groups (1000s of runtime files) would swamp the DOM — render each in
  // pages of 100 with an explicit "show more".
  const [memoryGroupLimits, setMemoryGroupLimits] = useState<Record<string, number>>({});
  // (grimoire-audit cave-gsvf) The only search feedback was the visual section
  // counters — announce result counts to screen readers, debounced past the
  // keystroke burst.
  useEffect(() => {
    if (!q) return;
    const t = window.setTimeout(() => {
      const total = visibleKnowledge.length + visibleMemory.length;
      announce(
        total === 0
          ? "No documents match"
          : `${total} ${total === 1 ? "match" : "matches"} — ${visibleKnowledge.length} stitches, ${visibleMemory.length} memory`,
        "polite",
      );
    }, 400);
    return () => window.clearTimeout(t);
  }, [q, visibleKnowledge.length, visibleMemory.length, announce]);

  const loading = knowledge === null || collections === null || memory === null || journal === null;
  // Roving focus for the open-document tab strip (←/→ between tabs, one tab
  // stop). The shared ui/tabs primitive has no per-tab close button, so the
  // strip stays hand-rolled — with the same tablist semantics.
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const { setActiveIndex: setTabStopIndex } = useRovingTabIndex({
    containerRef: tabStripRef,
    itemSelector: '[role="tab"]',
    orientation: "horizontal",
  });
  const selectedTabIndex = openTabs.findIndex((t) => selectionKey(t) === selectedKey);
  useEffect(() => {
    if (selectedTabIndex >= 0) setTabStopIndex(selectedTabIndex);
  }, [selectedTabIndex, setTabStopIndex]);

  // Roving focus for the navigator rail (↑/↓ across section headers, memory
  // group toggles, and document rows — one tab stop), so reaching Journal
  // never means tabbing through hundreds of memory rows.
  const railListRef = useRef<HTMLDivElement | null>(null);
  useRovingTabIndex({
    containerRef: railListRef,
    itemSelector: "[data-rail-item]",
    orientation: "vertical",
  });

  // Index of every loaded doc, used to resolve a doc's outgoing [[wiki-links]].
  const docIndex = useMemo<WikiDocIndex>(
    () => ({
      knowledge: (knowledge ?? []).map((k) => ({ id: k.id, collection: k.collection, title: k.title })),
      memory: (memory ?? []).map((m) => ({ path: m.fullPath })),
      // A familiar's own entry is part of its identity (`journal:<id>:<date>`).
      journal: (journal ?? []).map((j) => {
        const familiar = journalRowFamiliar(j);
        return { date: j.date, ...(familiar ? { familiar } : {}) };
      }),
    }),
    [knowledge, memory, journal],
  );

  // The client-built graph over the knowledge vault (bodies already loaded, no
  // fetch) — the instant stand-in while the full-corpus scan is in flight, and
  // the fallback if that scan fails.
  const localGraph = useMemo(
    () =>
      buildDocGraph(
        (knowledge ?? []).map((k) => ({
          ref: { kind: "knowledge" as const, id: k.id, ...(k.collection ? { collection: k.collection } : {}) },
          title: k.title,
          markdown: k.body,
          tags: k.tags,
        })),
        docIndex,
      ),
    [knowledge, docIndex],
  );

  // Graph generation is enforced: the server scan when it lands, the local
  // knowledge graph until then — the graph is never blank while docs exist.
  const graph = scan?.graph ?? localGraph;

  // Ownership lives on the memory inventory, not on the graph (nodes carry only
  // paths), so the lookup is built from the UNSCOPED list — filtering it first
  // would leave every dropped file unattributable.
  const memoryOwnerByNodeId = useMemo(() => buildMemoryOwnerIndex(memory ?? []), [memory]);

  // The Relations graph follows the same multiselect as the Memory rail: an
  // empty selection is "All", otherwise memory nodes narrow to the selected
  // familiars while stitches and journal days stay coven-wide. Backlinks and
  // [[wiki-link]] resolution deliberately keep reading the unscoped `graph` — a
  // document's own connections are an integrity signal, not a corpus browse,
  // and must not change shape because a UI filter is on.
  const scopedGraph = useMemo(
    () => scopeDocGraph(graph, memoryScope, memoryOwnerByNodeId),
    [graph, memoryScope, memoryOwnerByNodeId],
  );

  // Incoming connections for the active doc (Obsidian's linked/unlinked
  // mentions), straight off the graph — selectionKey matches docRefKey.
  const backlinks = useMemo<GrimoireBacklink[]>(() => {
    if (!selection || selection.kind === "knowledge-new" || selection.kind === "stitch-new") return [];
    const activeKey = selectionKey(selection);
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    const out: GrimoireBacklink[] = [];
    const seen = new Set<string>();
    for (const e of graph.edges) {
      if (e.target !== activeKey || e.type === "tag" || seen.has(e.source)) continue;
      seen.add(e.source);
      const source = nodesById.get(e.source);
      if (source?.ref) out.push({ ref: source.ref, title: source.title, type: e.type });
    }
    return out;
  }, [graph, selection]);

  /** Human tab label for a selection (falls back to ids/paths). */
  const tabTitle = useCallback(
    (sel: GrimoireSelection): string => {
      if (sel.kind === "knowledge-new") return "New entry";
      if (sel.kind === "stitch-new") return "New stitch";
      if (sel.kind === "knowledge") {
        const entry = (knowledge ?? []).find((e) => sameKnowledgeDoc(e, sel));
        return entry ? stitchDisplayTitle(entry, missionTitles) : knowledgeDocKey(sel.id, sel.collection);
      }
      if (sel.kind === "memory") return sel.path.split("/").pop() ?? sel.path;
      if (sel.familiar) return `${journalDayLabel(sel.date, dateTimePrefs)} · ${familiarLabel(sel.familiar)}`;
      return journalDayLabel(sel.date, dateTimePrefs);
    },
    [knowledge, dateTimePrefs, familiarLabel, missionTitles],
  );
  // The launcher's Continue/Recall rows read the same disambiguated titles.
  const launcherKnowledge = useMemo(
    () => (knowledge ?? []).map((entry) => ({ ...entry, title: stitchDisplayTitle(entry, missionTitles) })),
    [knowledge, missionTitles],
  );
  const readerTitle = selection
    ? selection.kind === "knowledge" && selectedKey && Object.hasOwn(knowledgeDrafts, selectedKey)
      ? parseMdDocument(knowledgeDrafts[selectedKey]).title?.trim() || "Untitled"
      : tabTitle(selection)
    : "";

  // (grimoire-audit cave-ezxb) The over-cap eviction in openDoc was silent — a
  // doc you had open just vanished. Announce it after the commit lands.
  useEffect(() => {
    if (!evictedRef.current) return;
    announce(`Closed ${tabTitle(evictedRef.current)} — ${MAX_OPEN_TABS}-tab limit reached`, "polite");
    evictedRef.current = null;
  }, [openTabs, announce, tabTitle]);

  // ── Navigator stitch rows ────────────────────────────────────────────────
  // Titles are cleaned of leaked markdown, machine tags (mission ids) give way
  // to a "Research" hint, and a mission's artifacts fold into one group.
  const renderStitchRow = (
    entry: GrimoireKnowledgeEntry,
    child?: { label: string },
  ) => {
    const flags = knowledgeEntryFlags(entry);
    const docKey = knowledgeDocKey(entry.id, entry.collection);
    const tags = stitchTagView(entry.tags);
    const title = child?.label ?? stitchDisplayTitle(entry, missionTitles);
    const updated = entry.modified ? relativeTime(entry.modified) : "";
    return (
      <NavRow
        key={docKey}
        selected={selectedKey === `knowledge:${docKey}`}
        title={title}
        tooltip={child ? stitchDisplayTitle(entry, missionTitles) : title}
        tags={child ? undefined : tags.tags}
        hint={!child && tags.research ? "Research" : undefined}
        meta={[entry.enabled ? "" : "off", updated].filter(Boolean).join(" · ") || undefined}
        nested={Boolean(child)}
        badge={
          flags.length > 0 ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full text-[var(--color-warning)]"
              title={`${flags.length} continuity flags`}
              aria-label={`${flags.length} continuity flags`}
            >
              <Icon name="ph:warning-circle" width={11} aria-hidden />
              <span className="text-[length:var(--text-2xs)]">{flags.length}</span>
            </span>
          ) : undefined
        }
        onClick={() =>
          openDoc({ kind: "knowledge", id: entry.id, ...(entry.collection ? { collection: entry.collection } : {}) })
        }
      />
    );
  };

  const renderMissionGroup = (group: Extract<StitchNavItem<GrimoireKnowledgeEntry>, { kind: "mission" }>) => {
    const holdsSelection = group.entries.some(
      ({ entry }) => selectedKey === `knowledge:${knowledgeDocKey(entry.id, entry.collection)}`,
    );
    // Folded by default; the group holding the open doc unfolds so its row is
    // visible, and an active search unfolds everything it matched.
    const expanded = Boolean(q) || (expandedMissionGroups[group.missionId] ?? holdsSelection);
    return (
      <div key={`mission:${group.missionId}`} className="grimoire-nav-mission">
        <button
          type="button"
          data-rail-item
          aria-expanded={expanded}
          title={group.title}
          onClick={() => toggleMissionGroup(group.missionId, expanded)}
          className={`focus-ring-inset w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)] ${
            holdsSelection && !expanded ? "bg-[var(--accent-presence)]/12" : ""
          }`}
        >
          <span className="flex items-center gap-1">
            <Icon
              name={expanded ? "ph:caret-down" : "ph:caret-right"}
              width={9}
              className="shrink-0 text-[var(--text-muted)]"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
              {group.title}
            </span>
            <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{group.entries.length}</span>
          </span>
          <span className="grimoire-nav-mission__meta mt-0.5 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Icon name="ph:flask" width={11} aria-hidden />
              Research
            </span>
            {group.modified ? <span className="ml-auto shrink-0">{relativeTime(group.modified)}</span> : null}
          </span>
        </button>
        {expanded ? (
          <div className="grimoire-nav-mission__children">
            {group.entries.map(({ entry, label }) => renderStitchRow(entry, { label }))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderStitchList = (entries: readonly GrimoireKnowledgeEntry[]) =>
    groupMissionStitches(entries, missionTitles).map((item) =>
      item.kind === "entry" ? renderStitchRow(item.entry) : renderMissionGroup(item),
    );

  /** The editor for one tab. Mounted only while the tab edits, or while it
   *  holds unsaved changes — then it stays mounted (hidden) so the draft
   *  survives reading, switching tabs, and coming back. */
  const renderTabEditor = (tab: GrimoireSelection, key: string) => {
    if (tab.kind === "memory") {
      return (
        <MemoryMdEditor
          key={tab.path}
          path={tab.path}
          sourceLabel={compactPath(tab.path)}
          visualLifecycleQueueRef={visualLifecycleQueueFor(key)}
          onCancel={() => stopEditing(key)}
          onSaved={() => bumpReader(key)}
          onDirtyChange={(dirty) => setTabDirty(key, dirty)}
        />
      );
    }
    if (tab.kind === "journal") {
      return (
        <JournalMdEditor
          date={tab.date}
          familiar={tab.familiar}
          visualLifecycleQueueRef={visualLifecycleQueueFor(key)}
          onSaved={() => {
            invalidateGrimoireLanding();
            void load(true);
            bumpReader(key);
          }}
          onDirtyChange={(dirty) => setTabDirty(key, dirty)}
        />
      );
    }
    if (tab.kind !== "knowledge" && tab.kind !== "knowledge-new") return null;
    const entry =
      tab.kind === "knowledge" ? (knowledge ?? []).find((e) => sameKnowledgeDoc(e, tab)) ?? null : null;
    return (
      <KnowledgeMdEditor
        entry={entry}
        visualLifecycleQueueRef={visualLifecycleQueueFor(key)}
        onDraftChange={(raw) => {
          setKnowledgeDrafts((previous) => (
            previous[key] === raw ? previous : { ...previous, [key]: raw }
          ));
        }}
        onSaved={(saved) => {
          replaceTab(key, { kind: "knowledge", id: saved.id, ...(saved.collection ? { collection: saved.collection } : {}) });
          invalidateGrimoireLanding();
          void load(true);
        }}
        // Cancelling a blank entry abandons it; cancelling an edit returns to reading.
        onCancel={() => (tab.kind === "knowledge-new" ? closeTab(key) : stopEditing(key))}
        onDirtyChange={(dirty) => setTabDirty(key, dirty)}
      />
    );
  };

  /** The reader for one persisted tab (active tab only — readers are cheap
   *  to rebuild, and an inactive tab's scroll position is remembered). */
  const renderTabReader = (tab: GrimoireSelection, key: string, editorMounted: boolean) => {
    const focusToken = readerFocusRequest?.key === key ? readerFocusRequest.n : 0;
    const shared = {
      docKey: key,
      docIndex,
      onOpenDoc: openDoc,
      onEdit: () => startEditing(key),
      focusToken,
      notice: editorMounted ? (
        <div role="status" className="grimoire-reader-notice">
          <Icon name="ph:warning-circle" width={12} aria-hidden />
          <span className="min-w-0 flex-1">This document has unsaved changes.</span>
          <button type="button" onClick={() => startEditing(key)} className="focus-ring grimoire-reader-notice__action">
            Resume editing
          </button>
        </div>
      ) : undefined,
    };
    if (tab.kind === "memory") {
      const file = (memory ?? []).find((m) => m.fullPath === tab.path);
      return (
        <MemoryDocReader
          {...shared}
          path={tab.path}
          active={key === selectedKey}
          refreshToken={readerRefresh[key] ?? 0}
          fallbackTitle={(tab.path.split("/").pop() ?? tab.path).replace(/\.(md|markdown)$/i, "")}
          kicker={file ? `Memory · ${file.rootLabel}` : "Memory"}
          meta={[file?.modified ? `Updated ${relativeTime(file.modified)}` : null]}
        />
      );
    }
    if (tab.kind === "journal") {
      const row = (journal ?? []).find((j) => j.date === tab.date && journalRowFamiliar(j) === tab.familiar);
      return (
        <JournalDocReader
          {...shared}
          date={tab.date}
          familiar={tab.familiar}
          refreshToken={readerRefresh[key] ?? 0}
          fallbackTitle={journalDayLabel(tab.date, dateTimePrefs)}
          kicker={tab.familiar ? `Journal · ${familiarLabel(tab.familiar)}` : "Journal"}
          meta={[
            // A legacy day file is attributed, not owned — still say who wrote it.
            !tab.familiar && row?.reflectedBy ? `Reflected by ${familiarLabel(row.reflectedBy)}` : null,
            row?.modified ? `Updated ${relativeTime(row.modified)}` : null,
          ]}
        />
      );
    }
    if (tab.kind !== "knowledge") return null;
    if (knowledge === null) {
      return <GrimoireDocReader {...shared} markdown={null} fallbackTitle={tabTitle(tab)} />;
    }
    const entry = knowledge.find((e) => sameKnowledgeDoc(e, tab));
    if (!entry) {
      return (
        <div className="grid h-full min-h-0 place-items-center p-8">
          <EmptyState
            icon="ph:file-x"
            headline="This stitch isn't in the library"
            subtitle="It may have been deleted or moved. Close the tab, or search the navigator for it."
            actions={
              <Button size="sm" onClick={() => closeTab(key)}>
                Close tab
              </Button>
            }
          />
        </div>
      );
    }
    const missionId = missionIdOf(entry.tags);
    const collection = entry.collection
      ? (collections ?? []).find((c) => c.id === entry.collection)
      : undefined;
    const collectionName = collection?.meta?.name;
    const kicker = missionId
      ? `Research · ${missionArtifactLabel(entry)}`
      : entry.collection
        ? (typeof collectionName === "string" && collectionName.trim()) || entry.collection
        : "Stitch";
    return (
      <GrimoireDocReader
        {...shared}
        // While an editor is mounted, read its live draft (it may not be saved yet).
        markdown={(editorMounted ? knowledgeDrafts[key] : undefined) ?? knowledgeEntryToRaw(entry)}
        fallbackTitle={stitchDisplayTitle(entry, missionTitles)}
        kicker={kicker}
        meta={[entry.modified ? `Updated ${relativeTime(entry.modified)}` : null, entry.enabled ? null : "Off"]}
      />
    );
  };

  /** One tab's detail: the reader by default, the editor while editing.
   *  Every open tab's panel stays mounted (hidden when inactive). */
  const renderTabDetail = (tab: GrimoireSelection) => {
    const key = selectionKey(tab);
    if (tab.kind === "stitch-new") {
      return (
        <StitchIntake
          key={`stitch-new-${stitchPrefill.nonce}`}
          initialRef={stitchPrefill.pinUrl}
          initialPatternId={stitchPrefill.patternId ?? null}
          onSewn={(entryId) => {
            replaceTab(key, { kind: "knowledge", id: entryId });
            invalidateGrimoireLanding();
            void load(true);
          }}
        />
      );
    }
    const editing = isTabEditing(tab);
    const editorMounted = editing || dirtyTabs[key] === true;
    const entry =
      tab.kind === "knowledge" ? (knowledge ?? []).find((e) => sameKnowledgeDoc(e, tab)) ?? null : null;
    const flags = entry ? knowledgeEntryFlags(entry) : [];
    return (
      <div className="flex h-full min-h-0 flex-col">
        {entry?.pins?.length ? (
          <StitchProvenance pins={entry.pins} onOpenMemory={(path) => openDoc({ kind: "memory", path })} />
        ) : null}
        {flags.length > 0 ? (
          <div className="shrink-0 border-y border-[color-mix(in_oklch,var(--color-warning)_34%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            <div className="mb-1 flex items-center gap-1 font-medium text-[var(--color-warning)]">
              <Icon name="ph:warning-circle" width={12} aria-hidden />
              Continuity flags — resolve by editing the <code className="font-mono">flags:</code> list in frontmatter
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              {flags.map((flag, i) => (
                <li key={`${flag}-${i}`}>{flag}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!editing && key === selectedKey ? (
          <div className="min-h-0 flex-1">{renderTabReader(tab, key, editorMounted)}</div>
        ) : null}
        {editorMounted ? (
          <div
            data-grimoire-editor={key}
            tabIndex={-1}
            className={editing ? "min-h-0 flex-1 outline-none" : "hidden"}
            // Capture phase: the visual editor consumes Esc itself (and marks
            // it handled), so the surface has to see it first.
            onKeyDownCapture={editing ? (event) => onEditorKeyDown(event, tab) : undefined}
          >
            {renderTabEditor(tab, key)}
          </div>
        ) : null}
      </div>
    );
  };

  const detail =
    openTabs.length === 0 ? (
      // No open tabs → Continue / Recall / Weave, driven only by the loaded
      // library, familiar-memory, journal, and relation data.
      <GrimoireLauncher
        knowledge={launcherKnowledge}
        memory={scopedMemory}
        journal={(journal ?? []).filter((day) => !day.reflectedBy || familiarInScope(memoryScope, day.reflectedBy))}
        graph={scopedGraph}
        scopeLabel={memoryScopeLabel}
        query={query}
        onQueryChange={setQuery}
        journalTitle={(date, familiar) =>
          familiar ? `${journalDayLabel(date, dateTimePrefs)} · ${familiarLabel(familiar)}` : journalDayLabel(date, dateTimePrefs)
        }
        onOpen={openDoc}
        onNewStitch={openStitchNew}
        onBlankEntry={() => openDoc({ kind: "knowledge-new" })}
        onShowJournal={() => setView("journal")}
        onShowGraph={() => setView("graph")}
      />
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={tabStripRef}
          role="tablist"
          aria-label="Open documents"
          className={focusMode ? "hidden" : "flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-hairline)] px-2 py-1"}
        >
          {openTabs.map((tab, i) => {
            const key = selectionKey(tab);
            const active = key === selectedKey;
            return (
              <span
                key={key}
                className={`inline-flex max-w-52 shrink-0 items-center overflow-hidden rounded-md border text-[length:var(--text-xs)] transition-colors ${
                  active
                    ? "border-[var(--accent-presence)]/40 bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  id={`grimoire-tab-${i}`}
                  aria-selected={active}
                  aria-controls={`grimoire-tabpanel-${i}`}
                  title={tabTitle(tab)}
                  onClick={() => setTabState((prev) => ({ ...prev, selection: tab }))}
                  className="focus-ring-inset min-w-0 truncate px-2 py-1"
                >
                  {tabTitle(tab)}
                </button>
                {dirtyTabs[key] ? (
                  <span
                    title="Unsaved changes"
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-presence)]"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label={`Close ${tabTitle(tab)}${dirtyTabs[key] ? " (unsaved changes)" : ""}`}
                  onClick={() => void requestCloseTab(key, tabTitle(tab))}
                  className="focus-ring-inset shrink-0 px-1.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:x" width={9} aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
        <div className="relative min-h-0 flex-1">
          {openTabs.map((tab, i) => {
            const key = selectionKey(tab);
            return (
              <div
                key={key}
                role="tabpanel"
                id={`grimoire-tabpanel-${i}`}
                aria-labelledby={`grimoire-tab-${i}`}
                className={key === selectedKey ? "h-full min-h-0" : "hidden"}
              >
                {renderTabDetail(tab)}
              </div>
            );
          })}
          {selectedKey === null ? (
            <div className="grid h-full min-h-0 place-items-center p-8">
              <EmptyState icon="ph:book-open" headline="Pick an open tab" subtitle="Or select a document from the list." />
            </div>
          ) : null}
        </div>
        {selection && selection.kind !== "knowledge-new" && selection.kind !== "stitch-new" ? (
          <GrimoireDocLinks
            key={selectedKey ?? ""}
            selection={selection}
            liveMarkdown={selection.kind === "knowledge" && selectedKey ? knowledgeDrafts[selectedKey] : undefined}
            knowledge={knowledge ?? []}
            collections={collections ?? []}
            docIndex={docIndex}
            backlinks={backlinks}
            onOpen={openDoc}
            onCreated={() => {
              invalidateGrimoireLanding();
              void load(true);
              refreshGraph();
            }}
          />
        ) : null}
      </div>
    );

  return (
    <div className={`grimoire-view flex h-full min-h-0 flex-col @container/grimoire${focusMode ? " grimoire-view--reader" : ""}`}>
      {/* Compact band: title left, the Library/Journal/
          Relations segmented tabs centered, contextual verbs right (the dashed
          "New stitch" control only makes sense in Library). */}
      {focusMode && selection ? (
        <header className="grimoire-reader-header">
          <h1 className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-[var(--text-secondary)]">
            {readerTitle}
          </h1>
          <span className="hidden text-[length:var(--text-2xs)] text-[var(--text-muted)] @min-[480px]/grimoire:inline">
            Esc to exit focus
          </span>
          <button
            type="button"
            onClick={() => {
              if (selectedKey) startEditing(selectedKey);
            }}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:pencil-simple" width={11} aria-hidden />
            Edit
          </button>
          <button
            type="button"
            onClick={leaveFocus}
            aria-label="Exit focus reading"
            title="Exit focus reading (Esc)"
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrows-in-simple" width={12} aria-hidden />
          </button>
        </header>
      ) : (
        <header className="surface-compact-header grimoire-header">
          <h1 className="surface-compact-title">Memories</h1>
          <div role="group" aria-label="Memories view" className="grimoire-tabs">
            <button
              type="button"
              aria-pressed={view === "docs"}
              onClick={() => setView("docs")}
              className="focus-ring grimoire-tab"
            >
              Library
            </button>
            <button
              type="button"
              aria-pressed={view === "journal"}
              onClick={() => setView("journal")}
              className="focus-ring grimoire-tab"
            >
              Journal
            </button>
            <button
              type="button"
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
              className="focus-ring grimoire-tab"
            >
              Relations
            </button>
          </div>
          <div className="surface-compact-actions">
            <div className="memories-familiar-filter">
              <span>Familiar</span>
              <StandardSelect
                className="memories-familiar-select"
                label="Filter memories by familiar"
                value={selectedFamiliarId}
                onChange={(familiarId) => {
                  setLocalFamiliarId(familiarId);
                  announce(familiarId ? `Showing memories for ${familiarLabel(familiarId)}` : "Showing memories in the current familiar scope", "polite");
                }}
                options={[
                  { value: "", label: shellScope.size ? "Selected familiars" : "All familiars" },
                  ...familiars.filter((f) => shellScope.size === 0 || shellScope.has(f.id)).map((f) => ({ value: f.id, label: f.display_name || f.id })),
                ]}
              />
            </div>
            {/* The wide landing owns Recall. Narrow panes show only the
                navigator, so retain its search even with no document open. */}
            {view === "docs" ? <div className={openTabs.length > 0 ? "contents" : "memories-mobile-search"}>
              <SearchInput
                value={query}
                onValueChange={setQuery}
                onClear={() => setQuery("")}
                placeholder="Search documents…"
                aria-label="Search grimoire documents"
                containerClassName="surface-compact-search"
              />
            </div> : null}
            {readerEligible && selectedKey ? (
              // Reading is the default; this one stable control toggles the
              // open document between reading and editing (E / Esc).
              <button
                ref={docModeTriggerRef}
                type="button"
                onClick={() => (selectedEditing ? stopEditing(selectedKey) : startEditing(selectedKey))}
                title={selectedEditing ? "Done editing — back to reading (Esc)" : "Edit this document (E)"}
                className={`focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[length:var(--text-xs)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${
                  selectedEditing
                    ? "border-[color-mix(in_oklch,var(--accent-presence)_45%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
                }`}
              >
                <Icon name={selectedEditing ? "ph:check" : "ph:pencil-simple"} width={11} aria-hidden />
                {selectedEditing ? "Done" : "Edit"}
              </button>
            ) : null}
            {view === "docs" ? (
              <button
                type="button"
                onClick={() => openStitchNew()}
                className="focus-ring grimoire-newstitch"
              >
                <Icon name="ph:push-pin" width={11} aria-hidden />
                New stitch
              </button>
            ) : null}
            <OverflowMenu ariaLabel="More Memories actions">
              <Link
                href="/weaves"
                role="menuitem"
                className="ui-popover-item focus-ring"
              >
                <span>Weaves</span>
              </Link>
              {view === "docs" ? (
                <>
                  <PopoverSeparator />
                  <PopoverItem icon="ph:push-pin" onSelect={() => openStitchNew()}>
                    New stitch
                  </PopoverItem>
                  <PopoverItem onSelect={() => openDoc({ kind: "knowledge-new" })}>
                    Blank entry
                  </PopoverItem>
                  {readerEligible ? (
                    <>
                      <PopoverSeparator />
                      {focusEligible ? (
                        <PopoverItem icon="ph:arrows-out-simple" onSelect={() => setFocusMode(true)}>
                          Focus reading
                        </PopoverItem>
                      ) : null}
                      <PopoverItem icon="ph:copy" onSelect={() => void copySelectionMarkdown()}>
                        Copy markdown
                      </PopoverItem>
                      <PopoverSeparator />
                      <PopoverItem
                        icon="ph:trash"
                        danger
                        disabled={deleting}
                        onSelect={() => void deleteSelection()}
                      >
                        {deleting
                          ? selection.kind === "memory" ? "Moving…" : "Deleting…"
                          : selection.kind === "memory" ? "Move to trash" : "Delete"}
                      </PopoverItem>
                    </>
                  ) : null}
                </>
              ) : null}
            </OverflowMenu>
          </div>
        </header>
      )}
      <div className={`grimoire-workspace flex min-h-0 flex-1${selection || view !== "docs" ? " grimoire-workspace--document" : ""}${focusMode ? " grimoire-workspace--reader" : ""}`}>
        <aside
          className={`grimoire-navigator h-full min-h-0 w-full flex-col border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 @min-[880px]/grimoire:shrink-0 ${
            navigatorCollapsedForDisplay ? "@min-[880px]/grimoire:w-[44px]" : "@min-[880px]/grimoire:w-[264px]"
          } ${
          // On a narrow container the rail and the main pane both go full-width,
          // so only one may show: a narrow open doc hides the rail. Journal and
          // Relations carry their own rails, so the Library navigator steps
          // aside at every width and gives them the full surface.
            focusMode
              ? "grimoire-navigator--reader"
              : view !== "docs"
                ? "grimoire-navigator--hidden"
                : selection
                  ? "grimoire-navigator--detail"
                  : ""
          }`}
        >
        {/* Title, surface verbs, and the doc search all live in the compact
            band above — the rail is purely the grouped navigator now. Its own
            header row names the rail so the collapse toggle isn't a floating,
            unlabelled control. The row is suppressed while a search is running,
            because the rail force-expands to keep results reachable. */}
        {!q ? (
          <div
            className={`flex shrink-0 items-center ${
              navigatorCollapsed ? "justify-center p-1" : "justify-between gap-2 p-1.5"
            }`}
          >
            {navigatorCollapsed ? null : (
              <h2 className="min-w-0 truncate pl-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Navigator
              </h2>
            )}
            <button
              type="button"
              onClick={toggleNavigator}
              aria-label={navigatorCollapsed ? "Expand Memories sidebar" : "Collapse Memories sidebar"}
              title={navigatorCollapsed ? "Expand Memories sidebar" : "Collapse Memories sidebar"}
              className="focus-ring-inset inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:sidebar-simple" width={14} aria-hidden />
            </button>
          </div>
        ) : null}
        {navigatorCollapsedForDisplay ? (
          <nav aria-label="Collapsed Memories navigator" className="flex min-h-0 flex-1 flex-col items-center gap-1 px-1 pb-2">
            <button
              type="button"
              onClick={() => revealNavigatorSection("knowledge")}
              aria-label="Open Stitches navigator"
              title="Open Stitches navigator"
              className="focus-ring-inset inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:book-open" width={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => revealNavigatorSection("memory")}
              aria-label="Open Memory files navigator"
              title="Open Memory files navigator"
              className="focus-ring-inset inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:brain" width={14} aria-hidden />
            </button>
          </nav>
        ) : (
        <div ref={railListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
          {loadError ? (
            <ErrorState compact headline="Couldn't load documents" subtitle={loadError} />
          ) : loading ? (
            <div className="space-y-2 p-2" aria-label="Loading documents" aria-busy="true">
              {["90%", "75%", "85%", "70%"].map((w, i) => (
                <Skeleton key={i} variant="text" width={w} />
              ))}
            </div>
          ) : (
            <>
              {/* An active search auto-expands every section — matches must be
                  reachable regardless of collapse state. */}
              <RailSection
                ariaLabel="Stitches"
                icon="ph:book-open"
                label="Stitches"
                description="Curated reference entries — sewn from pinned sources or written by hand"
                count={visibleKnowledge.length}
                collapsed={!q && collapsedSections.knowledge}
                onToggle={() => toggleSection("knowledge")}
              >
                {visibleKnowledge.length === 0 ? (
                  <p className="px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {q ? "No matches." : "No stitches yet — pin sources and sew your first entry."}
                  </p>
                ) : (
                  <>
                    {renderStitchList(knowledgeGroups.root)}
                    {knowledgeGroups.collections.map((group) => {
                      const collapsed = !q && (collapsedStitchGroups[group.id] ?? false);
                      return (
                        <div key={group.id}>
                          <button
                            type="button"
                            data-rail-item
                            aria-expanded={!collapsed}
                            title={group.storyQuestion}
                            onClick={() => toggleStitchGroup(group.id)}
                            className="focus-ring-inset flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                          >
                            <Icon name={collapsed ? "ph:caret-right" : "ph:caret-down"} width={9} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-left">
                              {group.label}
                              {group.storyQuestion ? (
                                <span className="ml-1 font-normal text-[var(--text-muted)]">· {group.storyQuestion}</span>
                              ) : null}
                            </span>
                            <span className="shrink-0 font-normal text-[var(--text-muted)]">{group.entries.length}</span>
                          </button>
                          {collapsed ? null : renderStitchList(group.entries)}
                        </div>
                      );
                    })}
                  </>
                )}
              </RailSection>
              <RailSection
                ariaLabel="Memory files"
                icon="ph:brain"
                label="Memory"
                description={
                  memoryScoped
                    ? `Memory files for ${memoryScopeLabel} — editable in place`
                    : "Files your familiars and runtimes write as they work — editable in place"
                }
                count={visibleMemory.length}
                collapsed={!q && collapsedSections.memory}
                onToggle={() => toggleSection("memory")}
              >
                {visibleMemory.length === 0 ? (
                  <p className="px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {q
                      ? "No matches."
                      : memoryScoped
                        ? `No memory for ${memoryScopeLabel} yet — clear the familiar filter to see everything.`
                        : "No memory yet — it fills in as your familiars work and remember."}
                  </p>
                ) : (
                  memoryGroups.map((group) => {
                    // A lone group renders flat — its header would only echo
                    // the row subtitles. Multiple roots get disclosures, and
                    // big groups start closed so runtime logs stay tamed.
                    const grouped = memoryGroups.length > 1;
                    const defaultCollapsed = grouped && group.entries.length > 20;
                    const collapsed =
                      grouped && !q && (collapsedMemoryGroups[group.label] ?? defaultCollapsed);
                    const limit = memoryGroupLimits[group.label] ?? 100;
                    const paged = group.entries.slice(0, limit);
                    return (
                      <div key={group.label}>
                        {grouped ? (
                          <button
                            type="button"
                            data-rail-item
                            aria-expanded={!collapsed}
                            onClick={() => toggleMemoryGroup(group.label, defaultCollapsed)}
                            className="focus-ring-inset flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                          >
                            <Icon name={collapsed ? "ph:caret-right" : "ph:caret-down"} width={9} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                            <span className="shrink-0 font-normal text-[var(--text-muted)]">
                              {group.entries.length}
                            </span>
                          </button>
                        ) : null}
                        {collapsed ? null : (
                          <>
                            {paged.map((entry) => (
                              <NavRow
                                key={entry.fullPath}
                                selected={selectedKey === `memory:${entry.fullPath}`}
                                title={entry.relPath.split("/").pop() ?? entry.relPath}
                                subtitle={
                                  grouped
                                    ? entry.relPath.includes("/")
                                      ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/"))
                                      : undefined
                                    : entry.rootLabel
                                }
                                meta={entry.modified ? relativeTime(entry.modified) : undefined}
                                onClick={() => openDoc({ kind: "memory", path: entry.fullPath })}
                              />
                            ))}
                            {group.entries.length > limit ? (
                              <button
                                type="button"
                                data-rail-item
                                onClick={() =>
                                  setMemoryGroupLimits((prev) => ({ ...prev, [group.label]: limit + 200 }))
                                }
                                className="focus-ring-inset w-full rounded-md px-2 py-1.5 text-left text-[length:var(--text-xs)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
                              >
                                Show more ({group.entries.length - limit} remaining)
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </RailSection>
            </>
          )}
        </div>
        )}
      </aside>
      <main
        className={`grimoire-document-pane h-full min-h-0 min-w-0 flex-1 border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 ${
          selection || view !== "docs" ? "" : "hidden @min-[880px]/grimoire:block"
        }`}
      >
        {view === "journal" ? (
          // Journal tab — the full daily-reflection surface (day rail, generate,
          // edit/delete with undo), scoped to the page's familiar selection. Not
          // `standalone`: it's inside the Workspace, so "Run now" and toast
          // actions ride the live event bus.
          <div className="grimoire-journal-tab flex h-full min-h-0 overflow-hidden">
            <JournalEntries familiars={familiars} activeFamiliarId={activeFamiliarId} scopeFamiliarIds={memoryScope} />
          </div>
        ) : view === "graph" ? (
          <div className="flex h-full min-h-0 flex-col">
            {/* Narrow-only: the rail is hidden while the graph is up (see the
                aside condition above), so give an explicit way back to the list
                — mirrors the document view's back header. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-1.5 @min-[880px]/grimoire:hidden">
              <button
                type="button"
                onClick={() => setView("docs")}
                aria-label="Back to document list"
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:arrow-left" width={13} aria-hidden />
              </button>
              <span className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">Documents</span>
            </div>
            <div className="min-h-0 flex-1">
              <GrimoireGraphView
                graph={scopedGraph}
                memoryOwnerByNodeId={memoryOwnerByNodeId}
                familiars={familiars}
                ownerLabel={familiarLabel}
                onRetry={refreshGraph}
                meta={scan?.meta ?? null}
                scopeLabel={memoryScopeLabel}
                scopedMemoryTotal={memoryScoped ? scopedMemory.length : null}
                scanning={scanning}
                scanError={scanError}
                onOpen={(ref) => {
                  openDoc(ref);
                  setView("docs");
                }}
              />
            </div>
          </div>
        ) : selection ? (
          <div className="flex h-full min-h-0 flex-col">
            {!focusMode ? (
              <div className="grimoire-mobile-back shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-1">
              <button
                type="button"
                onClick={() => setTabState((prev) => ({ ...prev, selection: null }))}
                aria-label="Back to document list"
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] @min-[880px]/grimoire:hidden"
              >
                <Icon name="ph:arrow-left" width={13} aria-hidden />
              </button>
              <span className="text-[length:var(--text-xs)] text-[var(--text-secondary)] @min-[880px]/grimoire:hidden">Documents</span>
              <span className="min-w-0 flex-1" />
              </div>
            ) : null}
            {deleteError ? (
              <div role="alert" className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-warning)]">
                {deleteError}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">{detail}</div>
          </div>
        ) : (
          detail
        )}
      </main>
      </div>
    </div>
  );
}
