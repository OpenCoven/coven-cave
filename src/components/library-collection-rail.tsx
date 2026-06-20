"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { LibraryCollection, LibrarySectionKind } from "@/lib/library-types";

// ── Types ────────────────────────────────────────────────────────────────────

export type Skill = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
  description?: string;
};

type ListSection = {
  id: LibrarySectionKind;
  label: string;
  icon: IconName;
};

const STATIC_LIST_SECTIONS: ListSection[] = [
  { id: "all",       label: "Timeline",  icon: "ph:link" },
  { id: "bookmarks", label: "Bookmarks", icon: "ph:bookmark-simple" },
  { id: "reading",   label: "Reading",   icon: "ph:book-open" },
  { id: "github",    label: "GitHub",    icon: "ph:github-logo" },
  { id: "projects",  label: "Projects",        icon: "ph:folder" },
];

function collectionDisplayLabel(collection: LibraryCollection): string {
  if (collection.id === "projects" && collection.label.trim().toLowerCase() === "projects") {
    return "Project docs";
  }
  return collection.label;
}

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  collections: LibraryCollection[];
  activeDocCollection: string;
  activeSection: LibrarySectionKind;
  docCounts: Record<string, number>;
  onSelectCollection: (id: string) => void;
  onSelectSection: (section: LibrarySectionKind) => void;
  onSelectSkill?: (skill: Skill) => void;
  activeSkillId?: string | null;
  canGoBack?: boolean;
  onBack?: () => void;
  onRefresh?: () => void;
  onQuickOpen?: () => void;
  refreshing?: boolean;
};

// ── Rail ─────────────────────────────────────────────────────────────────────

export function LibraryCollectionRail({
  collections,
  activeDocCollection,
  activeSection,
  docCounts,
  onSelectCollection,
  onSelectSection,
  onSelectSkill,
  activeSkillId,
  canGoBack = false,
  onBack,
  onRefresh,
  onQuickOpen,
  refreshing = false,
}: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);

  // Fetch skills from daemon via Cave proxy. Exposed as a callback so the
  // header Refresh button can re-pull them alongside the parent's reload.
  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      const json = await res.json().catch(() => null) as { ok?: boolean; skills?: Skill[] } | null;
      if (json?.ok && Array.isArray(json.skills)) setSkills(json.skills);
    } catch { /* daemon unavailable — section stays hidden */ }
  }, []);

  useEffect(() => { void loadSkills(); }, [loadSkills]);

  const handleRefresh = useCallback(() => {
    onRefresh?.();
    void loadSkills();
  }, [onRefresh, loadSkills]);

  return (
    <div className="library-rail">

      {/* ── Research collections ─────────────────────────────── */}
      <div className="library-rail-header library-rail-header--actions">
        <span className="library-rail-header-title">Library</span>
        <div className="library-rail-header-actions">
          {onQuickOpen && (
            <button
              type="button"
              className="library-rail-action"
              onClick={() => onQuickOpen()}
              title="Search the library ( / )"
              aria-label="Search the library"
            >
              <Icon name="ph:magnifying-glass" width={13} />
            </button>
          )}
          <button
            type="button"
            className="library-rail-action"
            onClick={() => onBack?.()}
            disabled={!canGoBack}
            title="Back"
            aria-label="Back to previous library view"
          >
            <Icon name="ph:arrow-left" width={13} />
          </button>
          <button
            type="button"
            className={`library-rail-action${refreshing ? " library-rail-action--spinning" : ""}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh library"
          >
            <Icon name="ph:arrow-clockwise" width={13} />
          </button>
        </div>
      </div>
      <div className="library-rail-list library-rail-list--collections">
        {collections.map((col) => {
          const count = docCounts[col.id] ?? 0;
          const isActive = activeSection === "docs" && col.id === activeDocCollection;
          const label = collectionDisplayLabel(col);
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
              <span className="library-rail-label">{label}</span>
              {count > 0 && <span className="library-rail-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="library-rail-divider" />

      {/* ── Static list sections ─────────────────────────────── */}
      <div className="library-rail-header">Lists</div>
      <div className="library-rail-list library-rail-list--sections">
        {STATIC_LIST_SECTIONS.map((section) => {
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

      {/* ── Skills (dynamic — only when daemon has skills) ────── */}
      {skills.length > 0 && (
        <>
          <div className="library-rail-divider" />
          <div className="library-rail-header library-rail-header--skills">
            <button
              type="button"
              className="library-rail-section-toggle"
              aria-expanded={skillsOpen || activeSection === "skills"}
              onClick={() => {
                const next = !skillsOpen;
                setSkillsOpen(next);
                if (next) onSelectSection("skills");
              }}
            >
              <Icon
                name="ph:caret-right-bold"
                width={10}
                className={`library-rail-caret${skillsOpen || activeSection === "skills" ? " library-rail-caret--open" : ""}`}
              />
              <span>Skills</span>
              <span className="library-rail-badge" style={{ marginLeft: "auto" }}>{skills.length}</span>
            </button>
          </div>
          {(skillsOpen || activeSection === "skills") && (
            <div className="library-rail-list library-rail-list--skills">
              {skills.map((skill) => {
                const isActive = activeSection === "skills" && activeSkillId === skill.id;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`library-rail-item library-rail-item--skill${isActive ? " library-rail-item--active" : ""}`}
                    onClick={() => {
                      onSelectSection("skills");
                      onSelectSkill?.(skill);
                    }}
                  >
                    <span className="library-rail-icon-wrap">
                      <Icon name="ph:book-bookmark" width={12} />
                    </span>
                    <span className="library-rail-label">{skill.name}</span>
                    {skill.category && (
                      <span className="library-rail-skill-cat">{skill.category}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

    </div>
  );
}
