"use client";

/**
 * Grimoire — the Cave's dedicated markdown-document surface.
 *
 * One OpenKnowledge-style home for every markdown document the coven keeps:
 *
 *   - Knowledge vault (~/.coven/knowledge) — curated reference entries,
 *     created and edited here (title/tags frontmatter map to the vault schema).
 *   - Memory files — every allow-listed memory root, editable in place with
 *     mtime-guarded saves (agents also write these; conflicts surface, never
 *     silently lose an update).
 *   - Journal reflections — daily entries, editable as plain markdown bodies.
 *
 * Left: a searchable navigator grouped by source. Right: the shared MdEditor
 * (VISUAL WYSIWYG / MARKDOWN raw) wired to the matching transport.
 *
 * Deep link: `#grimoire:<kind>:<id>` selects a document on entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { MdEditor, type MdEditorSaveResult } from "@/components/md-editor/md-editor";
import { MemoryMdEditor } from "@/components/md-editor/memory-md-editor";
import { parseMdDocument, serializeMdDocument, type MdDocument } from "@/lib/md-frontmatter";
import { relativeTime } from "@/lib/relative-time";
import { GRIMOIRE_HASH_PREFIX } from "@/lib/grimoire-link";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemoryFile } from "@/lib/use-memory-file";
import { resolveOutgoingLinks, type WikiDocIndex } from "@/lib/wiki-link-resolve";

// ── Navigator model ──────────────────────────────────────────────────────────

type KnowledgeEntry = {
  id: string;
  title: string;
  tags: string[];
  scope: "global" | string[];
  enabled: boolean;
  body: string;
};

type MemoryEntry = {
  relPath: string;
  fullPath: string;
  modified: string;
  sourceKindLabel: string;
  rootLabel: string;
  familiarId?: string;
};

type JournalSummary = { date: string; preview: string; reflectedBy: string | null; modified: string | null };

export type GrimoireSelection =
  | { kind: "knowledge"; id: string }
  | { kind: "knowledge-new" }
  | { kind: "memory"; path: string }
  | { kind: "journal"; date: string };

function selectionKey(sel: GrimoireSelection): string {
  if (sel.kind === "knowledge") return `knowledge:${sel.id}`;
  if (sel.kind === "memory") return `memory:${sel.path}`;
  if (sel.kind === "journal") return `journal:${sel.date}`;
  return "knowledge-new";
}

function readGrimoireHash(): GrimoireSelection | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith(GRIMOIRE_HASH_PREFIX)) return null;
  const rest = hash.slice(GRIMOIRE_HASH_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  let id: string;
  try {
    id = decodeURIComponent(rest.slice(sep + 1));
  } catch {
    return null;
  }
  if (!id) return null;
  if (kind === "knowledge") return { kind: "knowledge", id };
  if (kind === "memory") return { kind: "memory", path: id };
  if (kind === "journal") return { kind: "journal", date: id };
  return null;
}

function writeGrimoireHash(sel: GrimoireSelection | null) {
  if (typeof window === "undefined") return;
  const base = window.location.pathname + window.location.search;
  if (!sel || sel.kind === "knowledge-new") {
    if (window.location.hash.startsWith(GRIMOIRE_HASH_PREFIX)) {
      window.history.replaceState(null, "", base);
    }
    return;
  }
  const id = sel.kind === "knowledge" ? sel.id : sel.kind === "memory" ? sel.path : sel.date;
  window.history.replaceState(null, "", `${base}${GRIMOIRE_HASH_PREFIX}${sel.kind}:${encodeURIComponent(id)}`);
}

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

const TABS_STORAGE_KEY = "cave:grimoire:tabs";
const ACTIVE_TAB_STORAGE_KEY = "cave:grimoire:active-tab";
export const MAX_OPEN_TABS = 8;

function parseStoredTabs(raw: string | null): GrimoireSelection[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tabs: GrimoireSelection[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      if (item.kind === "knowledge" && typeof item.id === "string" && item.id) {
        tabs.push({ kind: "knowledge", id: item.id });
      } else if (item.kind === "memory" && typeof item.path === "string" && item.path) {
        tabs.push({ kind: "memory", path: item.path });
      } else if (item.kind === "journal" && typeof item.date === "string" && item.date) {
        tabs.push({ kind: "journal", date: item.date });
      }
      // "knowledge-new" drafts are intentionally NOT restored across reloads.
    }
    return tabs.slice(0, MAX_OPEN_TABS);
  } catch {
    return [];
  }
}

function readStoredTabs(): { tabs: GrimoireSelection[]; activeKey: string | null } {
  if (typeof window === "undefined") return { tabs: [], activeKey: null };
  try {
    const tabs = parseStoredTabs(window.localStorage.getItem(TABS_STORAGE_KEY));
    const activeKey = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return { tabs, activeKey: activeKey && tabs.some((t) => selectionKey(t) === activeKey) ? activeKey : null };
  } catch {
    return { tabs: [], activeKey: null };
  }
}

function writeStoredTabs(tabs: GrimoireSelection[], activeKey: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify(tabs.filter((t) => t.kind !== "knowledge-new")),
    );
    if (activeKey) window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeKey);
    else window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
  } catch {
    /* private mode — tabs stay session-only */
  }
}

// ── Knowledge ↔ raw-markdown mapping ─────────────────────────────────────────

/** A vault entry as one raw markdown doc: title/tags ride the frontmatter the
 *  MdEditor header edits; scope/enabled ride through as preserved keys. */
export function knowledgeEntryToRaw(entry: KnowledgeEntry): string {
  const doc: MdDocument = {
    hasFrontmatter: true,
    title: entry.title,
    tags: entry.tags,
    rest: {
      scope: entry.scope === "global" ? "global" : entry.scope.join(", "),
      enabled: entry.enabled,
    },
    body: entry.body,
  };
  return serializeMdDocument(doc);
}

export function rawToKnowledgePayload(id: string | null, raw: string) {
  const doc = parseMdDocument(raw);
  return {
    ...(id ? { id } : {}),
    title: doc.title ?? "",
    tags: doc.tags,
    scope: doc.rest.scope ?? "global",
    enabled: doc.rest.enabled !== false,
    body: doc.body.trim(),
  };
}

// ── Detail editors ───────────────────────────────────────────────────────────

function KnowledgeMdEditor({
  entry,
  onSaved,
  onCancel,
}: {
  /** null → creating a new entry. */
  entry: KnowledgeEntry | null;
  onSaved: (entry: KnowledgeEntry) => void;
  onCancel?: () => void;
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
      const payload = rawToKnowledgePayload(entry?.id ?? null, raw);
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
    [entry?.id, onSaved],
  );
  return (
    <MdEditor
      key={entry?.id ?? "new"}
      value={initial}
      sourceLabel="Knowledge vault"
      onSave={save}
      onCancel={onCancel}
      // A new entry materializes on its first (manual) save, which re-keys and
      // remounts this editor; only autosave once it exists so typing isn't
      // interrupted mid-keystroke by that remount.
      autoSave={entry != null}
    />
  );
}

function JournalMdEditor({ date, onSaved }: { date: string; onSaved?: () => void }) {
  const [state, setState] = useState<{ reflection: string; reflectedBy: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/journal?date=${encodeURIComponent(date)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) setError(json.error ?? "Failed to load journal entry");
        else setState({
          reflection: json.entry?.reflection ?? "",
          reflectedBy: json.entry?.reflectedBy ?? null,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load journal entry");
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const save = useCallback(
    async (raw: string): Promise<MdEditorSaveResult> => {
      if (!raw.trim()) return { ok: false, error: "Write a reflection before saving." };
      try {
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, reflection: raw, reflectedBy: state?.reflectedBy ?? null }),
        });
        const json = await res.json();
        if (!json.ok) return { ok: false, error: json.error ?? "Save failed" };
        onSaved?.();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
      }
    },
    [date, onSaved, state?.reflectedBy],
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
      key={date}
      value={state.reflection}
      showHeader={false}
      sourceLabel={`Journal · ${date}`}
      onSave={save}
      autoSave
    />
  );
}

// ── Navigator row ────────────────────────────────────────────────────────────

function NavRow({
  selected,
  title,
  subtitle,
  meta,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`focus-ring-inset w-full rounded-md px-2 py-1.5 text-left transition-colors ${
        selected
          ? "bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
      }`}
    >
      <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{title}</span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
        {subtitle ? <span className="min-w-0 truncate font-mono">{subtitle}</span> : null}
        {meta ? <span className="shrink-0">{meta}</span> : null}
      </span>
    </button>
  );
}

// ── Wiki-link chips ──────────────────────────────────────────────────────────

/** The open doc's outgoing [[wiki-links]], resolved against the loaded docs and
 *  shown as a chip row below the editor. Resolved chips navigate; unresolved
 *  ones (no matching doc) render dashed + inert. Mounted only for the active
 *  doc, so exactly one doc's content is read at a time. */
function GrimoireDocLinks({
  selection,
  knowledge,
  docIndex,
  onOpen,
}: {
  selection: GrimoireSelection;
  knowledge: KnowledgeEntry[];
  docIndex: WikiDocIndex;
  onOpen: (sel: GrimoireSelection) => void;
}) {
  // useMemoryFile is a hook, so it's always called; a null path is a no-op.
  const memoryPath = selection.kind === "memory" ? selection.path : null;
  const memFile = useMemoryFile(memoryPath, { reveal: true });

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
        const res = await fetch(`/api/journal?date=${encodeURIComponent(selection.date)}`, { cache: "no-store" });
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
      ? knowledge.find((k) => k.id === selection.id)?.body ?? ""
      : selection.kind === "memory"
        ? memFile.text ?? ""
        : selection.kind === "journal"
          ? journalMd ?? ""
          : "";

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

  if (links.length === 0) return null;

  return (
    <div className="grimoire-doc-links flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
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
            className="focus-ring rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_50%,var(--border-hairline))] hover:text-[var(--text-primary)]"
          >
            {display}
          </button>
        ) : (
          <span
            key={i}
            title="No matching Grimoire doc"
            className="rounded-full border border-dashed border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
          >
            {display}
          </span>
        );
      })}
    </div>
  );
}

// ── Surface ──────────────────────────────────────────────────────────────────

export function GrimoireView() {
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[] | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[] | null>(null);
  const [journal, setJournal] = useState<JournalSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const confirm = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Open tabs + the active one. A #grimoire: deep link wins over the restored
  // active tab and is merged into the restored tab set.
  const [{ openTabs, selection }, setTabState] = useState<{
    openTabs: GrimoireSelection[];
    selection: GrimoireSelection | null;
  }>(() => {
    const stored = readStoredTabs();
    const fromHash = readGrimoireHash();
    if (fromHash) {
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

  /** Open (or focus) a document tab. */
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
        tabs = tabs.filter((_, i) => i !== evictIndex);
      }
      return { openTabs: tabs, selection: sel };
    });
  }, []);

  const closeTab = useCallback((key: string) => {
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

  /** Swap one tab for another in place (e.g. a saved draft gaining its id). */
  const replaceTab = useCallback((fromKey: string, next: GrimoireSelection) => {
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
  }, [openTabs, selection]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [kRes, mRes, jRes] = await Promise.all([
        fetch("/api/knowledge", { cache: "no-store" }),
        fetch("/api/memory", { cache: "no-store" }),
        fetch("/api/journal", { cache: "no-store" }),
      ]);
      const [k, m, j] = await Promise.all([kRes.json(), mRes.json(), jRes.json()]);
      setKnowledge(k.ok && Array.isArray(k.entries) ? k.entries : []);
      setMemory(m.ok && Array.isArray(m.entries) ? m.entries : []);
      setJournal(j.ok && Array.isArray(j.days) ? j.days : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load documents");
    }
  }, []);

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

  // Delete/trash the selected document. Memory files archive to the memory
  // trash (restorable via POST /api/memory/restore); knowledge entries and
  // journal reflections delete through their APIs.
  const deleteSelection = useCallback(async () => {
    if (!selection || selection.kind === "knowledge-new" || deleting) return;
    const label =
      selection.kind === "memory"
        ? "Move this memory file to the trash?"
        : selection.kind === "knowledge"
          ? "Delete this knowledge entry?"
          : `Delete the journal reflection for ${selection.date}?`;
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
            ? await fetch(`/api/knowledge?id=${encodeURIComponent(selection.id)}`, { method: "DELETE" })
            : await fetch(`/api/journal?date=${encodeURIComponent(selection.date)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        setDeleteError(json.error ?? "Delete failed");
        return;
      }
      // A deleted document's tab closes with it.
      closeTab(selectionKey(selection));
      void load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [closeTab, confirm, deleting, load, selection]);

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (...fields: Array<string | undefined | null>) =>
      !q || fields.some((f) => f && f.toLowerCase().includes(q)),
    [q],
  );

  const visibleKnowledge = useMemo(
    () => (knowledge ?? []).filter((e) => matches(e.title, e.id, e.tags.join(" "))),
    [knowledge, matches],
  );
  const visibleMemory = useMemo(
    () => (memory ?? []).filter((e) => matches(e.relPath, e.fullPath, e.rootLabel, e.familiarId)),
    [memory, matches],
  );
  // Big memory inventories (1000s of runtime files) would swamp the DOM —
  // render in pages of 100 with an explicit "show more".
  const [memoryLimit, setMemoryLimit] = useState(100);
  const pagedMemory = useMemo(() => visibleMemory.slice(0, memoryLimit), [visibleMemory, memoryLimit]);
  const visibleJournal = useMemo(
    () => (journal ?? []).filter((d) => matches(d.date, d.preview)),
    [journal, matches],
  );

  const loading = knowledge === null || memory === null || journal === null;
  const selectedKey = selection ? selectionKey(selection) : null;

  // Index of every loaded doc, used to resolve a doc's outgoing [[wiki-links]].
  const docIndex = useMemo<WikiDocIndex>(
    () => ({
      knowledge: (knowledge ?? []).map((k) => ({ id: k.id, title: k.title })),
      memory: (memory ?? []).map((m) => ({ path: m.fullPath })),
      journal: (journal ?? []).map((j) => ({ date: j.date })),
    }),
    [knowledge, memory, journal],
  );

  /** Human tab label for a selection (falls back to ids/paths). */
  const tabTitle = useCallback(
    (sel: GrimoireSelection): string => {
      if (sel.kind === "knowledge-new") return "New entry";
      if (sel.kind === "knowledge") {
        return (knowledge ?? []).find((e) => e.id === sel.id)?.title ?? sel.id;
      }
      if (sel.kind === "memory") return sel.path.split("/").pop() ?? sel.path;
      return sel.date;
    },
    [knowledge],
  );

  /** Detail editor for one tab. Every open tab stays mounted (hidden when
   *  inactive) so unsaved drafts survive switching tabs. */
  const renderTabDetail = (tab: GrimoireSelection) => {
    const key = selectionKey(tab);
    if (tab.kind === "memory") {
      return (
        <MemoryMdEditor
          key={tab.path}
          path={tab.path}
          sourceLabel={compactPath(tab.path)}
          onCancel={() => closeTab(key)}
        />
      );
    }
    if (tab.kind === "journal") {
      return <JournalMdEditor date={tab.date} onSaved={() => void load()} />;
    }
    const entry =
      tab.kind === "knowledge" ? (knowledge ?? []).find((e) => e.id === tab.id) ?? null : null;
    return (
      <KnowledgeMdEditor
        entry={entry}
        onSaved={(saved) => {
          replaceTab(key, { kind: "knowledge", id: saved.id });
          void load();
        }}
        onCancel={() => closeTab(key)}
      />
    );
  };

  const detail =
    openTabs.length === 0 ? (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:book-open"
          headline="Select a document"
          subtitle="Pick a knowledge entry, memory file, or journal day — or start a new knowledge entry."
        />
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div
          role="tablist"
          aria-label="Open documents"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-hairline)] px-2 py-1.5"
        >
          {openTabs.map((tab) => {
            const key = selectionKey(tab);
            const active = key === selectedKey;
            return (
              <span
                key={key}
                className={`inline-flex max-w-52 shrink-0 items-center overflow-hidden rounded-md border text-[11px] transition-colors ${
                  active
                    ? "border-[var(--accent-presence)]/40 bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tabTitle(tab)}
                  onClick={() => setTabState((prev) => ({ ...prev, selection: tab }))}
                  className="focus-ring-inset min-w-0 truncate px-2 py-1"
                >
                  {tabTitle(tab)}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tabTitle(tab)}`}
                  onClick={() => closeTab(key)}
                  className="focus-ring-inset shrink-0 px-1.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:x" width={9} aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
        <div className="relative min-h-0 flex-1">
          {openTabs.map((tab) => {
            const key = selectionKey(tab);
            return (
              <div key={key} className={key === selectedKey ? "h-full min-h-0" : "hidden"}>
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
        {selection && selection.kind !== "knowledge-new" ? (
          <GrimoireDocLinks
            key={selectedKey ?? ""}
            selection={selection}
            knowledge={knowledge ?? []}
            docIndex={docIndex}
            onOpen={openDoc}
          />
        ) : null}
      </div>
    );

  return (
    <div className="grimoire-view flex h-full min-h-0 gap-3 p-3 @container/grimoire">
      <aside
        className={`flex h-full min-h-0 w-full flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 @min-[880px]/grimoire:w-[300px] @min-[880px]/grimoire:shrink-0 ${
          selection ? "hidden @min-[880px]/grimoire:flex" : ""
        }`}
      >
        <div className="shrink-0 space-y-2 border-b border-[var(--border-hairline)] p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Grimoire</h2>
            <button
              type="button"
              onClick={() => openDoc({ kind: "knowledge-new" })}
              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:plus" width={11} aria-hidden />
              New entry
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) setQuery("");
            }}
            placeholder="Search documents…"
            aria-label="Search grimoire documents"
            className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
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
              <section aria-label="Knowledge vault">
                <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Knowledge · {visibleKnowledge.length}
                </h3>
                {visibleKnowledge.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                    {q ? "No matches." : "No entries yet — curate durable reference knowledge here."}
                  </p>
                ) : (
                  visibleKnowledge.map((entry) => (
                    <NavRow
                      key={entry.id}
                      selected={selectedKey === `knowledge:${entry.id}`}
                      title={entry.title}
                      subtitle={entry.tags.length ? entry.tags.map((t) => `#${t}`).join(" ") : entry.id}
                      meta={entry.enabled ? undefined : "off"}
                      onClick={() => openDoc({ kind: "knowledge", id: entry.id })}
                    />
                  ))
                )}
              </section>
              <section aria-label="Memory files">
                <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Memory · {visibleMemory.length}
                </h3>
                {visibleMemory.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                    {q ? "No matches." : "No memory files found."}
                  </p>
                ) : (
                  <>
                    {pagedMemory.map((entry) => (
                      <NavRow
                        key={entry.fullPath}
                        selected={selectedKey === `memory:${entry.fullPath}`}
                        title={entry.relPath.split("/").pop() ?? entry.relPath}
                        subtitle={entry.rootLabel}
                        meta={entry.modified ? relativeTime(entry.modified) : undefined}
                        onClick={() => openDoc({ kind: "memory", path: entry.fullPath })}
                      />
                    ))}
                    {visibleMemory.length > memoryLimit ? (
                      <button
                        type="button"
                        onClick={() => setMemoryLimit((n) => n + 200)}
                        className="focus-ring-inset w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
                      >
                        Show more ({visibleMemory.length - memoryLimit} remaining)
                      </button>
                    ) : null}
                  </>
                )}
              </section>
              <section aria-label="Journal">
                <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Journal · {visibleJournal.length}
                </h3>
                {visibleJournal.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                    {q ? "No matches." : "No journal entries yet."}
                  </p>
                ) : (
                  visibleJournal.map((day) => (
                    <NavRow
                      key={day.date}
                      selected={selectedKey === `journal:${day.date}`}
                      title={day.date}
                      subtitle={day.preview}
                      onClick={() => openDoc({ kind: "journal", date: day.date })}
                    />
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </aside>
      <main
        className={`h-full min-h-0 min-w-0 flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 ${
          selection ? "" : "hidden @min-[880px]/grimoire:block"
        }`}
      >
        {selection ? (
          <div className="flex h-full min-h-0 flex-col">
            <div
              className={`flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-1.5 ${
                selection.kind === "knowledge-new" ? "@min-[880px]/grimoire:hidden" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setTabState((prev) => ({ ...prev, selection: null }))}
                aria-label="Back to document list"
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] @min-[880px]/grimoire:hidden"
              >
                <Icon name="ph:arrow-left" width={13} aria-hidden />
              </button>
              <span className="text-[11px] text-[var(--text-secondary)] @min-[880px]/grimoire:hidden">Documents</span>
              <span className="min-w-0 flex-1" />
              {deleteError ? (
                <span role="alert" className="min-w-0 truncate text-[10px] text-[var(--color-warning)]">
                  {deleteError}
                </span>
              ) : null}
              {selection.kind !== "knowledge-new" ? (
                <button
                  type="button"
                  onClick={() => void deleteSelection()}
                  disabled={deleting}
                  className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[10px] text-[var(--text-secondary)] enabled:hover:border-[var(--color-danger)]/40 enabled:hover:bg-[var(--color-danger)]/10 enabled:hover:text-[var(--color-danger)] disabled:opacity-50"
                >
                  <Icon name="ph:trash" width={11} aria-hidden />
                  {deleting
                    ? selection.kind === "memory" ? "Moving…" : "Deleting…"
                    : selection.kind === "memory" ? "Move to trash" : "Delete"}
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">{detail}</div>
          </div>
        ) : (
          detail
        )}
      </main>
    </div>
  );
}
