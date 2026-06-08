"use client";

import { useEffect, useMemo } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiars: Familiar[];
  activeId: string | null;
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  harnessInstalled?: (harnessId: string) => boolean | undefined;
  onSelect: (id: string) => void;
  onAddFamiliar: () => void;
  onToggleSidebar: () => void;
};

export function FamiliarAvatarRail({
  familiars,
  activeId,
  sessions,
  responseNeeded,
  harnessInstalled,
  onSelect,
  onAddFamiliar,
  onToggleSidebar,
}: Props) {
  const overrides = useGlyphOverrides();

  useEffect(() => {
    if (!activeId) return;
    const el = document.querySelector(
      `.familiar-avatar-rail__avatar[data-id="${activeId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      m.set(s.familiarId, (m.get(s.familiarId) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  return (
    <aside
      className="familiar-avatar-rail"
      aria-label="Familiars"
    >
      <ul className="familiar-avatar-rail__list">
        {familiars.map((f) => {
          const active = f.id === activeId;
          const needsReply = responseNeeded.has(f.id);
          const presence = computePresence({
            familiar: f,
            sessions,
            needsReply,
            harnessInstalled: f.harness ? harnessInstalled?.(f.harness) : undefined,
            isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
          });
          const liveCount = liveCounts.get(f.id) ?? 0;
          return (
            <li key={f.id}>
              <button
                type="button"
                data-id={f.id}
                className={`familiar-avatar-rail__avatar${active ? " familiar-avatar-rail__avatar--active" : ""}`}
                aria-label={`${f.display_name}${needsReply ? ` — reply needed` : ""}${liveCount ? ` — ${liveCount} live` : ""}`}
                aria-pressed={active}
                title={`${f.display_name} · ${presence.label}`}
                onClick={() => onSelect(f.id)}
              >
                <FamiliarGlyph
                  glyph={resolveFamiliarGlyph(f, overrides)}
                  size="sm"
                />
                <span
                  className={`familiar-avatar-rail__presence ${presence.dot}`}
                  aria-hidden
                />
                {needsReply ? (
                  <span
                    className="familiar-avatar-rail__unread"
                    aria-hidden
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="familiar-avatar-rail__add"
        aria-label="Add familiar"
        title="Add familiar"
        onClick={onAddFamiliar}
      >
        <Icon name="ph:plus-bold" width={12} />
      </button>

      <button
        type="button"
        className="familiar-avatar-rail__toggle"
        aria-label="Toggle sidebar"
        title="Toggle sidebar (⌘B)"
        onClick={onToggleSidebar}
      >
        <Icon name="ph:sidebar-simple" width={14} />
      </button>
    </aside>
  );
}
