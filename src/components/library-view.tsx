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
import type {
  LibraryCollection,
  LibraryDoc,
  LibraryDocBody,
  LibraryBookmark,
  LibraryReadingItem,
  LibraryGitHubItem,
  LibrarySectionKind,
} from "@/lib/library-types";

export function LibraryView() {
  const [activeSection, setActiveSection] = useState<LibrarySectionKind>("docs");
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

  const loadDocs = useCallback(async (collectionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library?collection=${encodeURIComponent(collectionId)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; docs?: LibraryDoc[]; collections?: LibraryCollection[] };
      if (json.ok) {
        setDocs(json.docs ?? []);
        if (json.collections?.length) setCollections(json.collections);
      } else setDocs([]);
    } catch { setDocs([]); }
    finally { setLoading(false); }
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
      {/* Preview pane — dominant left content area */}
      <LibraryDocPreview selected={selectedItem} loading={previewLoading} />

      {/* Collapsible list panel — matches browser rail expand/collapse pattern */}
      <div
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
          {activeSection === "docs" && (
            <LibraryDocList
              docs={docs}
              selectedId={selectedDocId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={handleSelectDoc}
              loading={loading}
            />
          )}
          {activeSection === "bookmarks" && (
            <LibraryBookmarksList
              selectedId={selectedBmId}
              onSelect={(item: LibraryBookmark) => setSelectedItem({ kind: "bookmark", item })}
              onDelete={(id) => { if (selectedBmId === id) setSelectedItem(null); }}
            />
          )}
          {activeSection === "reading" && (
            <LibraryReadingList
              selectedId={selectedReadId}
              onSelect={(item: LibraryReadingItem) => setSelectedItem({ kind: "reading", item })}
              onDelete={(id) => { if (selectedReadId === id) setSelectedItem(null); }}
            />
          )}
          {activeSection === "github" && (
            <LibraryGitHubList
              selectedId={selectedGhId}
              onSelect={(item: LibraryGitHubItem) => setSelectedItem({ kind: "github", item })}
              onDelete={(id) => { if (selectedGhId === id) setSelectedItem(null); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
