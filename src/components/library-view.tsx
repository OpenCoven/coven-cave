"use client";

import "@/styles/library.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { LibraryCollectionRail } from "@/components/library-collection-rail";
import { LibraryDocList } from "@/components/library-doc-list";
import { LibraryBookmarksList } from "@/components/library-bookmarks-list";
import { LibraryReadingList } from "@/components/library-reading-list";
import { LibraryGitHubList } from "@/components/library-github-list";
import { LibraryDocPreview, type SelectedItem } from "@/components/library-doc-preview";
import { LibraryQuickOpen, type LibraryQuickItem } from "@/components/library-quick-open";
import { LibraryTimeline } from "@/components/library-timeline";
import { ComuxView } from "@/components/comux-view";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar, SessionRow } from "@/lib/types";
import type {
  LibraryCollection,
  LibraryDoc,
  LibraryDocBody,
  LibraryBookmark,
  LibraryReadingItem,
  LibraryGitHubItem,
  LibrarySectionKind,
} from "@/lib/library-types";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { useProjects } from "@/lib/use-projects";

type LibraryViewProps = {
  onOpenUrl?: (url: string) => void;
  sessions?: SessionRow[];
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  onNewProjectChat?: (projectRoot: string) => void;
};

function entryQuickKey(entry: TimelineEntry, index: number): string {
  const item = entry.item as TimelineEntry["item"] & { id?: string; url?: string; title?: string };
  if (item.id) return `${entry.list}:${item.id}`;
  return `${entry.list}:legacy:${item.url ?? item.title ?? "untitled"}:${entry.capturedAt ?? "unknown"}:${index}`;
}

// Map a unified timeline entry (bookmark / reading / github) to a quick-open row.
function entryToQuickItem(e: TimelineEntry, index: number): LibraryQuickItem {
  if (e.list === "bookmarks") {
    const b = e.item as LibraryBookmark;
    return {
      key: entryQuickKey(e, index),
      kind: "bookmark",
      title: b.title || b.domain,
      hint: b.domain,
      icon: "ph:bookmark-simple",
      entry: e,
    };
  }
  if (e.list === "reading") {
    const r = e.item as LibraryReadingItem;
    return {
      key: entryQuickKey(e, index),
      kind: "reading",
      title: r.title,
      hint: r.author ?? r.sourceType,
      icon: "ph:book-open",
      entry: e,
    };
  }
  const g = e.item as LibraryGitHubItem;
  return {
    key: entryQuickKey(e, index),
    kind: "github",
    title: g.title,
    hint: g.number ? `${g.repo}#${g.number}` : g.repo,
    icon: "ph:github-logo",
    entry: e,
  };
}

export function LibraryView({ sessions, onOpenSession, onNewProjectChat }: LibraryViewProps = {}) {
  const [activeSection, setActiveSection] = useState<LibrarySectionKind>("all");
  const [activeCollection, setActiveCollection] = useState("all");
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [listPinned, setListPinned] = useState(true);
  const listExpanded = listPinned;
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [timelineSelectedId, setTimelineSelectedId] = useState<string | null>(null);
  const [boardDraft, setBoardDraft] = useState<LibraryBookmark | null>(null);
  const { projects } = useProjects({ enabled: boardDraft !== null });
  // Quick-open ("/") palette: a unified search/jump across docs + captured links.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickItems, setQuickItems] = useState<LibraryQuickItem[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const loadCollectionsRequestRef = useRef(0);
  const loadDocsRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const quickOpenRequestRef = useRef(0);

  // ── Nav history (powers the rail's Back control) ─────────────────────────
  // A "location" is the section + collection + skill triple. We record the
  // location we just left whenever it changes, so Back can restore it. The
  // effect coalesces multi-setState navigations (e.g. selecting a collection
  // sets both collection and section) into one transition via React batching.
  type NavLoc = { section: LibrarySectionKind; collection: string; skillId: string | null };
  const [navHistory, setNavHistory] = useState<NavLoc[]>([]);
  const prevLocRef = useRef<NavLoc>({ section: "all", collection: "all", skillId: null });
  const goingBackRef = useRef(false);
  useEffect(() => {
    const cur: NavLoc = { section: activeSection, collection: activeCollection, skillId: activeSkillId };
    const prev = prevLocRef.current;
    const same = prev.section === cur.section && prev.collection === cur.collection && prev.skillId === cur.skillId;
    if (same) return;
    if (goingBackRef.current) {
      goingBackRef.current = false;
    } else {
      setNavHistory((h) => [...h, prev]);
    }
    prevLocRef.current = cur;
  }, [activeSection, activeCollection, activeSkillId]);

  useEffect(() => {
    void fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok: boolean; familiars?: Familiar[] }) => { if (j.ok) setFamiliars(j.familiars ?? []); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "[") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || target.isContentEditable) return;
      e.preventDefault();
      setListPinned((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const [docsError, setDocsError] = useState<string | null>(null);

  const loadCollections = useCallback(async () => {
    const requestId = ++loadCollectionsRequestRef.current;
    try {
      const res = await fetch("/api/library?collection=all&docs=0", { cache: "no-store" });
      const json = await res.json() as { ok: boolean; collections?: LibraryCollection[] };
      if (requestId !== loadCollectionsRequestRef.current) return;
      if (json.ok && json.collections?.length) setCollections(json.collections);
    } catch { /* collections will populate when docs load */ }
  }, []);

  useEffect(() => { void loadCollections(); }, [loadCollections]);

  const loadDocs = useCallback(async (collectionId: string) => {
    const requestId = ++loadDocsRequestRef.current;
    setLoading(true);
    setDocsError(null);
    try {
      const res = await fetch(`/api/library?collection=${encodeURIComponent(collectionId)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; docs?: LibraryDoc[]; collections?: LibraryCollection[]; error?: string };
      if (requestId !== loadDocsRequestRef.current) return;
      if (json.ok) {
        setDocs(json.docs ?? []);
        if (json.collections?.length) setCollections(json.collections);
      } else {
        setDocs([]);
        setDocsError(json.error ?? "Library API returned an error.");
      }
    } catch (err) {
      if (requestId !== loadDocsRequestRef.current) return;
      setDocs([]);
      setDocsError(err instanceof Error ? err.message : "Network error loading library.");
    } finally {
      if (requestId === loadDocsRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "docs") return;
    void loadDocs(activeCollection);
  }, [activeCollection, activeSection, loadDocs]);

  const handleSelectDoc = useCallback(async (doc: LibraryDoc) => {
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/library/doc?id=${encodeURIComponent(doc.id)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; doc?: LibraryDocBody };
      if (requestId === previewRequestRef.current && json.ok && json.doc) {
        setSelectedItem({ kind: "doc", doc: json.doc });
      }
    } catch { /* no-op */ }
    finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }, []);

  const handleRenameMoveDoc = useCallback(async (doc: LibraryDoc, patch: { title?: string; collection?: string }) => {
    const res = await fetch("/api/library/doc", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: doc.id, title: patch.title, collection: patch.collection }),
    });
    const json = await res.json() as { ok: boolean; doc?: LibraryDocBody; error?: string };
    if (!res.ok || !json.ok || !json.doc) {
      throw new Error(json.error ?? "Could not update file.");
    }

    await loadDocs(activeCollection);
    if (selectedItem?.kind === "doc" && selectedItem.doc.id === doc.id) {
      setSelectedItem({ kind: "doc", doc: json.doc });
    }
  }, [activeCollection, loadDocs, selectedItem]);

  // Open the quick-open palette and (re)fetch a global snapshot of everything
  // searchable: all docs (across collections) + every captured link. Fetched on
  // open so it reflects the latest library regardless of the current nav.
  const closeQuickOpen = useCallback(() => {
    quickOpenRequestRef.current += 1;
    setQuickOpen(false);
    setQuickLoading(false);
  }, []);

  const openQuickOpen = useCallback(async () => {
    const requestId = ++quickOpenRequestRef.current;
    setQuickOpen(true);
    setQuickLoading(true);
    try {
      const [allRes, docsRes] = await Promise.all([
        fetch("/api/library/all", { cache: "no-store" }),
        fetch("/api/library?collection=all", { cache: "no-store" }),
      ]);
      const allJson = (await allRes.json()) as { ok: boolean; entries?: TimelineEntry[] };
      const docsJson = (await docsRes.json()) as { ok: boolean; docs?: LibraryDoc[] };
      const next: LibraryQuickItem[] = [];
      if (docsJson.ok) {
        for (const d of docsJson.docs ?? []) {
          next.push({
            key: `doc:${d.id}`,
            kind: "doc",
            title: d.title,
            hint: d.collection,
            icon: "ph:file-text",
            doc: d,
          });
        }
      }
      if (allJson.ok) {
        for (const [index, e] of (allJson.entries ?? []).entries()) next.push(entryToQuickItem(e, index));
      }
      if (requestId !== quickOpenRequestRef.current) return;
      setQuickItems(next);
    } catch {
      if (requestId === quickOpenRequestRef.current) setQuickItems([]);
    } finally {
      if (requestId === quickOpenRequestRef.current) setQuickLoading(false);
    }
  }, []);

  const handleQuickSelect = useCallback(
    (item: LibraryQuickItem) => {
      closeQuickOpen();
      if (item.kind === "doc" && item.doc) {
        const doc = item.doc as LibraryDoc;
        setActiveSection("docs");
        setActiveCollection(doc.collection || "all");
        void handleSelectDoc(doc);
        return;
      }
      const entry = item.entry as TimelineEntry | undefined;
      if (!entry) return;
      setActiveSection(entry.list);
      setTimelineSelectedId(entry.item.id);
      if (entry.list === "bookmarks") {
        setSelectedItem({ kind: "bookmark", item: entry.item as LibraryBookmark });
      } else if (entry.list === "reading") {
        setSelectedItem({ kind: "reading", item: entry.item as LibraryReadingItem });
      } else {
        setSelectedItem({ kind: "github", item: entry.item as LibraryGitHubItem });
      }
    },
    [closeQuickOpen, handleSelectDoc],
  );

  // "/" opens quick-open (when not typing). library-view only mounts on the
  // Library surface, so this window listener is naturally scoped to it. (⌘K is
  // the global command palette — distinct from this library-content search.)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      e.preventDefault();
      void openQuickOpen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openQuickOpen]);

  function handleSectionChange(section: LibrarySectionKind) {
    setActiveSection(section);
    setSelectedItem(null);
    setSearchQuery("");
    if (section !== "skills") setActiveSkillId(null);
  }

  function handleCollectionChange(collectionId: string) {
    setActiveCollection(collectionId);
    setSelectedItem(null);
    setSearchQuery("");
  }

  function goBack() {
    setNavHistory((h) => {
      if (h.length === 0) return h;
      const target = h[h.length - 1];
      goingBackRef.current = true;
      setActiveSection(target.section);
      setActiveCollection(target.collection);
      setActiveSkillId(target.skillId);
      setSelectedItem(null);
      setSearchQuery("");
      return h.slice(0, -1);
    });
  }

  // Reload the active Library surface without forcing the hidden Docs list to
  // read markdown files while the user is on Timeline/Bookmarks/Reading/GitHub.
  // Skills are owned by the rail, which re-fetches them from its own Refresh
  // handler alongside this.
  const reloadLibrary = useCallback(() => {
    if (activeSection === "docs") void loadDocs(activeCollection);
    else void loadCollections();
  }, [activeSection, activeCollection, loadDocs, loadCollections]);

  const docCounts: Record<string, number> = { [activeCollection]: docs.length };
  const selectedDocId =  selectedItem?.kind === "doc"      ? selectedItem.doc.id  : null;
  // Reader prev/next: position of the open doc within the current list.
  const selectedDocIndex = selectedDocId ? docs.findIndex((d) => d.id === selectedDocId) : -1;
  const docNav = selectedDocIndex >= 0
    ? {
        index: selectedDocIndex,
        total: docs.length,
        onPrev: () => { const prev = docs[selectedDocIndex - 1]; if (prev) void handleSelectDoc(prev); },
        onNext: () => { const next = docs[selectedDocIndex + 1]; if (next) void handleSelectDoc(next); },
      }
    : undefined;
  const selectedBmId =   selectedItem?.kind === "bookmark" ? selectedItem.item.id : null;
  const selectedReadId = selectedItem?.kind === "reading"  ? selectedItem.item.id : null;
  const selectedGhId =   selectedItem?.kind === "github"   ? selectedItem.item.id : null;
  const showBrowseCanvas = selectedItem === null && activeSection !== "skills" && activeSection !== "projects";

  function renderLibraryListContent() {
    if (activeSection === "all") {
      return (
        <LibraryTimeline
          familiars={familiars}
          selectedEntryId={timelineSelectedId}
          onSelect={(entry: TimelineEntry) => {
            setTimelineSelectedId(entry.item.id);
            if (entry.list === "bookmarks") {
              setSelectedItem({ kind: "bookmark", item: entry.item as any });
            } else if (entry.list === "reading") {
              setSelectedItem({ kind: "reading", item: entry.item as any });
            } else {
              setSelectedItem({ kind: "github", item: entry.item as any });
            }
          }}
        />
      );
    }
    if (activeSection === "docs") {
      return (
        <LibraryDocList
          docs={docs}
          selectedId={selectedDocId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={handleSelectDoc}
          loading={loading}
          collections={collections}
          activeCollection={activeCollection}
          onRenameMove={handleRenameMoveDoc}
          error={docsError}
          onRetry={() => void loadDocs(activeCollection)}
        />
      );
    }
    if (activeSection === "bookmarks") {
      return (
        <LibraryBookmarksList
          selectedId={selectedBmId}
          onSelect={(item: LibraryBookmark) => {
            setSelectedItem({ kind: "bookmark", item });
          }}
          onDelete={(id) => { if (selectedBmId === id) setSelectedItem(null); }}
          onAddToBoard={(bookmark) => setBoardDraft(bookmark)}
        />
      );
    }
    if (activeSection === "reading") {
      return (
        <LibraryReadingList
          selectedId={selectedReadId}
          onSelect={(item: LibraryReadingItem) => {
            setSelectedItem({ kind: "reading", item });
          }}
          onDelete={(id) => { if (selectedReadId === id) setSelectedItem(null); }}
        />
      );
    }
    if (activeSection === "github") {
      return (
        <LibraryGitHubList
          selectedId={selectedGhId}
          onSelect={(item: LibraryGitHubItem) => {
            setSelectedItem({ kind: "github", item });
          }}
          onDelete={(id) => { if (selectedGhId === id) setSelectedItem(null); }}
          onOpenSession={onOpenSession}
        />
      );
    }
    return null;
  }

  return (
    <div className="library-shell">
      <LibraryCollectionRail
        collections={collections}
        activeDocCollection={activeCollection}
        activeSection={activeSection}
        docCounts={docCounts}
        onSelectCollection={handleCollectionChange}
        onSelectSection={handleSectionChange}
        activeSkillId={activeSkillId}
        onSelectSkill={(skill) => {
          setActiveSkillId(skill.id);
          setSelectedItem({ kind: "skill", skill });
        }}
        canGoBack={navHistory.length > 0}
        onBack={goBack}
        onRefresh={reloadLibrary}
        onQuickOpen={() => void openQuickOpen()}
        refreshing={loading}
      />
      <div className="library-divider" />
      {/* Preview pane — dominant left content area; projects owns the full canvas */}
      {activeSection === "projects" ? (
        <div className="library-preview library-preview--full-canvas" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <ComuxView
            view="projects"
            sessions={sessions ?? []}
            onOpenSession={onOpenSession ?? (() => undefined)}
            onNewChat={onNewProjectChat ?? (() => undefined)}
          />
        </div>
      ) : showBrowseCanvas ? (
        <div className="library-browse-canvas">
          <div className="library-browse-content">
            {renderLibraryListContent()}
          </div>
        </div>
      ) : (
        <LibraryDocPreview selected={selectedItem} loading={previewLoading} activeSection={activeSection} docNav={docNav} />
      )}

      {/* Collapsible list panel — hidden when skills or projects are active (these sections own the full canvas) */}
      {activeSection !== "skills" && activeSection !== "projects" && !showBrowseCanvas && <div
        className={[
          "library-list-panel",
          "transition-[width] duration-200 ease-out",
          listExpanded ? "library-list-panel--open" : "library-list-panel--closed",
        ].join(" ")}
      >
        {/* Toggle strip — always visible, sits on the left edge of the panel */}
        <div className="library-list-toggle">
          <button
            type="button"
            className="library-list-toggle-btn"
            onClick={() => setListPinned((v) => !v)}
            aria-label={listPinned ? "Collapse list" : "Pin list open"}
            aria-pressed={listPinned}
            title={listPinned ? "Collapse list" : "Pin list open"}
          >
            <Icon
              name={listPinned ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"}
              width={13}
            />
          </button>
        </div>

        {/* Actual list content — fades out when collapsed */}
        <div className={[
          "library-list-content",
          listExpanded ? "library-list-content--visible" : "library-list-content--hidden",
        ].join(" ")}>
          {renderLibraryListContent()}
        </div>
      </div>
      }
      {/* Add-to-Board modal — triggered from bookmark rows */}
      {boardDraft && (
        <NewCardModal
          open={boardDraft !== null}
          onClose={() => setBoardDraft(null)}
          familiars={familiars}
          sessions={sessions ?? []}
          projects={projects}
          defaultStatus="inbox"
          defaultTitle={boardDraft.title || boardDraft.domain || ""}
          defaultLinks={[boardDraft.url]}
          defaultNotes={[boardDraft.url, boardDraft.notes].filter(Boolean).join("\n")}
          defaultLabels={boardDraft.tags}
          onCreate={async (draft: NewCardDraft) => {
            // Throw on failure so NewCardModal surfaces the error and keeps the
            // dialog open, instead of silently closing on a lost save.
            const res = await fetch("/api/board", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: draft.title,
                notes: draft.notes,
                status: draft.status,
                priority: draft.priority,
                projectId: draft.projectId,
                links: draft.links,
                labels: draft.labels,
              }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.ok) {
              throw new Error(json?.error ?? "Couldn't save to the board. Please try again.");
            }
            setBoardDraft(null);
          }}
        />
      )}
      {quickOpen && (
        <LibraryQuickOpen
          items={quickItems}
          loading={quickLoading}
          onSelect={handleQuickSelect}
          onClose={closeQuickOpen}
        />
      )}
    </div>
  );
}
