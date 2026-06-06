"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { LibraryCollection, LibrarySectionKind } from "@/lib/library-types";

type ListSection = {
  id: LibrarySectionKind;
  label: string;
  icon: IconName;
};

const LIST_SECTIONS: ListSection[] = [
  { id: "bookmarks", label: "Bookmarks", icon: "ph:bookmark-simple" },
  { id: "reading",   label: "Reading",   icon: "ph:book-open" },
  { id: "github",    label: "GitHub",    icon: "ph:github-logo" },
];

type Props = {
  collections: LibraryCollection[];
  activeDocCollection: string;
  activeSection: LibrarySectionKind;
  docCounts: Record<string, number>;
  onSelectCollection: (id: string) => void;
  onSelectSection: (section: LibrarySectionKind) => void;
};

export function LibraryCollectionRail({
  collections,
  activeDocCollection,
  activeSection,
  docCounts,
  onSelectCollection,
  onSelectSection,
}: Props) {
  return (
    <div className="library-rail">
      <div className="library-rail-header">Research</div>
      <div className="library-rail-list">
        {collections.map((col) => {
          const count = docCounts[col.id] ?? 0;
          const isActive = activeSection === "docs" && col.id === activeDocCollection;
          return (
            <button
              key={col.id}
              type="button"
              className={`library-rail-item${isActive ? " library-rail-item--active" : ""}`}
              onClick={() => {
                onSelectCollection(col.id);
                onSelectSection("docs");
              }}
            >
              {col.icon && (
                <span className="library-rail-icon-wrap">
                  <Icon name={col.icon as IconName} width={13} />
                </span>
              )}
              <span className="library-rail-label">{col.label}</span>
              {count > 0 && <span className="library-rail-badge">{count}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ height: 1, margin: "8px 12px", background: "var(--border-hairline)" }} />
      <div className="library-rail-header">Lists</div>
      <div className="library-rail-list">
        {LIST_SECTIONS.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`library-rail-item${isActive ? " library-rail-item--active" : ""}`}
              onClick={() => onSelectSection(section.id)}
            >
              <span className="library-rail-icon-wrap">
                <Icon name={section.icon} width={13} />
              </span>
              <span className="library-rail-label">{section.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
