"use client";

import { useEffect, useState } from "react";
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
  { id: "projects",  label: "Projects",  icon: "ph:folder" },
];

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
}: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);

  // Fetch skills from daemon via Cave proxy
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        const json = await res.json().catch(() => null) as { ok?: boolean; skills?: Skill[] } | null;
        if (json?.ok && Array.isArray(json.skills)) setSkills(json.skills);
      } catch { /* daemon unavailable — section stays hidden */ }
    })();
  }, []);

  return (
    <div className="library-rail">

      {/* ── Research collections ─────────────────────────────── */}
      <div className="library-rail-header">Library</div>
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

      <div className="library-rail-divider" />

      {/* ── Static list sections ─────────────────────────────── */}
      <div className="library-rail-header">Lists</div>
      <div className="library-rail-list">
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
          <div className="library-rail-header">
            <button
              type="button"
              className="library-rail-section-toggle"
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
            <div className="library-rail-list">
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
