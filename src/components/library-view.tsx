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
import { LibraryTimeline } from "@/components/library-timeline";
import { ComuxView } from "@/components/comux-view";
import { LibraryGraphView } from "@/components/library-graph-view";
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

type LibraryViewProps = {
  onOpenUrl?: (url: string) => void;
  sessions?: SessionRow[];
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  onNewProjectChat?: (projectRoot: string) => void;
};

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
  const [listHover, setListHover] = useState(false);
  const listExpanded = listPinned || listHover;
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [timelineSelectedId, setTimelineSelectedId] = useState<string | null>(null);
  const [boardDraft, setBoardDraft] = useState<LibraryBookmark | null>(null);

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

  const loadDocs = useCallback(async (collectionId: string) => {
    setLoading(true);
    setDocsError(null);
    try {
      const res = await fetch(`/api/library?collection=${encodeURIComponent(collectionId)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; docs?: LibraryDoc[]; collections?: LibraryCollection[]; error?: string };
      if (json.ok) {
        setDocs(json.docs ?? []);
        if (json.collections?.length) setCollections(json.collections);
      } else {
        setDocs([]);
        setDocsError(json.error ?? "Library API returned an error.");
      }
    } catch (err) {
      setDocs([]);
      setDocsError(err instanceof Error ? err.message : "Network error loading library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDocs(activeCollection); }, [activeCollection, loadDocs]);

  const handleSelectDoc = useCallback(async (doc: LibraryDoc) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/library/doc?id=${encodeURIComponent(doc.id)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; doc?: LibraryDocBody };
      if (json.ok && json.doc) setSelectedItem({ kind: "doc", doc: json.doc });
    } catch { /* no-op */ }
    finally { setPreviewLoading(false); }
  }, []);

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
      />
      <div className="library-divider" />
      {/* Preview pane — dominant left content area; graph section owns the full canvas */}
      {activeSection === "graph" ? (
        <div className="library-preview" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <LibraryGraphView />
        </div>
      ) : (
        <LibraryDocPreview selected={selectedItem} loading={previewLoading} activeSection={activeSection} docNav={docNav} />
      )}

      {/* Collapsible list panel — hidden when graph or skills are active (these sections own the full canvas) */}
      {activeSection !== "graph" && activeSection !== "skills" && <div
        className={[
          "library-list-panel",
          "transition-[width] duration-200 ease-out",
          listExpanded ? "library-list-panel--open" : "library-list-panel--closed",
        ].join(" ")}
        onMouseEnter={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setListHover(true);
        }}
        onMouseLeave={() => {
          hoverTimerRef.current = setTimeout(() => setListHover(false), 120);
        }}
      >
        {/* Toggle strip — always visible, sits on the left edge of the panel */}
        <div className="library-list-toggle">
          <button
            type="button"
            className="library-list-toggle-btn"
            onClick={() => setListPinned((v) => !v)}
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
          {activeSection === "all" && (
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
          )}
          {activeSection === "docs" && (
            <LibraryDocList
              docs={docs}
              selectedId={selectedDocId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={handleSelectDoc}
              loading={loading}
              error={docsError}
              onRetry={() => void loadDocs(activeCollection)}
            />
          )}
          {activeSection === "bookmarks" && (
            <LibraryBookmarksList
              selectedId={selectedBmId}
              onSelect={(item: LibraryBookmark) => {
                setSelectedItem({ kind: "bookmark", item });
              }}
              onDelete={(id) => { if (selectedBmId === id) setSelectedItem(null); }}
              onAddToBoard={(bookmark) => setBoardDraft(bookmark)}
            />
          )}
          {activeSection === "reading" && (
            <LibraryReadingList
              selectedId={selectedReadId}
              onSelect={(item: LibraryReadingItem) => {
                setSelectedItem({ kind: "reading", item });
              }}
              onDelete={(id) => { if (selectedReadId === id) setSelectedItem(null); }}
            />
          )}
          {activeSection === "github" && (
            <LibraryGitHubList
              selectedId={selectedGhId}
              onSelect={(item: LibraryGitHubItem) => {
                setSelectedItem({ kind: "github", item });
              }}
              onDelete={(id) => { if (selectedGhId === id) setSelectedItem(null); }}
            />
          )}
          {activeSection === "projects" && (
            <ComuxView
              view="projects"
              sessions={sessions ?? []}
              onOpenSession={onOpenSession ?? (() => undefined)}
              onNewChat={onNewProjectChat ?? (() => undefined)}
            />
          )}
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
          defaultStatus="inbox"
          defaultTitle={boardDraft.title || boardDraft.domain || ""}
          defaultLinks={[boardDraft.url]}
          defaultNotes={[boardDraft.url, boardDraft.notes].filter(Boolean).join("\n")}
          defaultLabels={boardDraft.tags}
          onCreate={async (draft: NewCardDraft) => {
            await fetch("/api/board", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: draft.title,
                notes: draft.notes,
                status: draft.status,
                priority: draft.priority,
                links: draft.links,
                labels: draft.labels,
              }),
            });
            setBoardDraft(null);
          }}
        />
      )}
    </div>
  );
}
