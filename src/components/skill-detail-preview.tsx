"use client";

// Detail preview for the `/skill` / `/skills` picker — shows the highlighted
// skill's full metadata (scope, kind, version, description, tags, path) beside
// the option list, so you can read what a skill does before running it.

import { Icon } from "@/lib/icon";
import type { SkillOption } from "@/lib/slash-skill";
import "@/styles/skill-detail-preview.css";

export function SkillDetailPreview({ skill }: { skill: SkillOption | null }) {
  if (!skill) {
    return (
      <div className="skill-preview skill-preview--empty" aria-hidden>
        Highlight a skill to preview it.
      </div>
    );
  }
  return (
    <div className="skill-preview" role="region" aria-label={`${skill.name} details`}>
      <div className="skill-preview__head">
        <Icon name="ph:sparkle" width={14} className="skill-preview__icon" aria-hidden />
        <span className="skill-preview__name">{skill.name}</span>
      </div>
      <div className="skill-preview__meta">
        {skill.familiar ? <span className="skill-preview__chip">{skill.familiar}</span> : null}
        {skill.kind ? <span className="skill-preview__chip">{skill.kind}</span> : null}
        {skill.version ? <span className="skill-preview__chip">v{skill.version}</span> : null}
      </div>
      {skill.description ? (
        <p className="skill-preview__desc">{skill.description}</p>
      ) : (
        <p className="skill-preview__desc skill-preview__desc--muted">No description provided.</p>
      )}
      {skill.tags?.length ? (
        <div className="skill-preview__tags">
          {skill.tags.slice(0, 8).map((t) => (
            <span key={t} className="skill-preview__tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {skill.path ? (
        <div className="skill-preview__path" title={skill.path}>
          {skill.path}
        </div>
      ) : null}
      <div className="skill-preview__hint">
        <kbd>↵</kbd> run · <kbd>↹</kbd> complete
      </div>
    </div>
  );
}
