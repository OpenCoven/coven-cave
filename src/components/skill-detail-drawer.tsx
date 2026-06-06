"use client";

import { useEffect } from "react";
import { Icon } from "@/lib/icon";

export type SkillEntry = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
  description?: string;
  version?: string;
  effective_rate?: number;
  applied_rate?: number;
  completion_rate?: number;
  fallback_rate?: number;
  source?: string;
};

export type FamiliarForSkill = {
  id: string;
  display_name: string;
};

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-[var(--bg-raised)] px-3 py-2 text-center">
      <span className="text-[15px] font-semibold text-[var(--text-primary)] tabular-nums">
        {Math.round(value * 100)}%
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

export function SkillDetailDrawer({
  skill,
  familiars,
  onClose,
}: {
  skill: SkillEntry | null;
  familiars: FamiliarForSkill[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!skill) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [skill, onClose]);

  if (!skill) return null;

  const initial = (skill.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const hasStats =
    skill.effective_rate !== undefined ||
    skill.applied_rate !== undefined ||
    skill.completion_rate !== undefined ||
    skill.fallback_rate !== undefined;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-sm flex-col bg-[var(--bg-panel)] shadow-2xl sm:max-w-[380px]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[var(--border-hairline)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--text-primary)]">
              {skill.name}
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {[
                skill.owner,
                skill.category,
                skill.version ? `v${skill.version}` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <Icon name="ph:x-bold" width={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Description */}
          {skill.description && (
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {skill.description}
            </p>
          )}

          {/* Tags */}
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
                >
                  <Icon name="ph:tag-bold" width={9} />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Stats */}
          {hasStats && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">
                Performance
              </p>
              <div className="grid grid-cols-2 gap-2">
                {skill.effective_rate !== undefined && (
                  <StatPill label="Effective" value={skill.effective_rate} />
                )}
                {skill.applied_rate !== undefined && (
                  <StatPill label="Applied" value={skill.applied_rate} />
                )}
                {skill.completion_rate !== undefined && (
                  <StatPill label="Completion" value={skill.completion_rate} />
                )}
                {skill.fallback_rate !== undefined && (
                  <StatPill label="Fallback" value={skill.fallback_rate} />
                )}
              </div>
            </div>
          )}

          {/* Per-familiar assignment */}
          {familiars.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">
                Assigned to
              </p>
              <div className="space-y-1">
                {familiars.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--bg-raised)]"
                  >
                    <span className="text-[12px] text-[var(--text-secondary)]">
                      {f.display_name}
                    </span>
                    <span className="text-[var(--text-muted)] opacity-40">
                      <Icon name="ph:toggle-left-bold" width={20} />
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-[var(--text-muted)] opacity-60">
                Assignment writes to daemon config — coming soon.
              </p>
            </div>
          )}

          {!skill.description &&
            (!skill.tags || skill.tags.length === 0) &&
            !hasStats &&
            familiars.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)]">
                No additional detail available.
              </p>
            )}
        </div>
      </aside>
    </>
  );
}
