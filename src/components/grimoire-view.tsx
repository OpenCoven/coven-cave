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
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

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

const GRIMOIRE_HASH_PREFIX = "#grimoire:";

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

// ── Surface ──────────────────────────────────────────────────────────────────

export function GrimoireView() {
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[] | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[] | null>(null);
  const [journal, setJournal] = useState<JournalSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<GrimoireSelection | null>(() => readGrimoireHash());

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
  const selectedKnowledge =
    selection?.kind === "knowledge" ? (knowledge ?? []).find((e) => e.id === selection.id) ?? null : null;

  const detail =
    selection === null ? (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:book-open"
          headline="Select a document"
          subtitle="Pick a knowledge entry, memory file, or journal day — or start a new knowledge entry."
        />
      </div>
    ) : selection.kind === "memory" ? (
      <MemoryMdEditor
        key={selection.path}
        path={selection.path}
        sourceLabel={compactPath(selection.path)}
        onCancel={() => setSelection(null)}
      />
    ) : selection.kind === "journal" ? (
      <JournalMdEditor date={selection.date} onSaved={() => void load()} />
    ) : (
      <KnowledgeMdEditor
        entry={selectedKnowledge}
        onSaved={(entry) => {
          setSelection({ kind: "knowledge", id: entry.id });
          void load();
        }}
        onCancel={() => setSelection(null)}
      />
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
              onClick={() => setSelection({ kind: "knowledge-new" })}
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
                      onClick={() => setSelection({ kind: "knowledge", id: entry.id })}
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
                        onClick={() => setSelection({ kind: "memory", path: entry.fullPath })}
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
                      onClick={() => setSelection({ kind: "journal", date: day.date })}
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
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-1.5 @min-[880px]/grimoire:hidden">
              <button
                type="button"
                onClick={() => setSelection(null)}
                aria-label="Back to document list"
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:arrow-left" width={13} aria-hidden />
              </button>
              <span className="text-[11px] text-[var(--text-secondary)]">Documents</span>
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
