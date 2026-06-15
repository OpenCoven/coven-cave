"use client";

import { useRef } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  onFamiliarScopeChange: (id: string | null) => void;
};

export function FamiliarDock({
  familiars,
  activeFamiliarId,
  onFamiliarScopeChange,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();
  const rowRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="familiar-dock" aria-label="Familiars">
      <div className="familiar-dock__row" ref={rowRef} role="toolbar" aria-label="Familiar scope">
        <button
          type="button"
          className={`familiar-dock__all${activeFamiliarId == null ? " familiar-dock__all--active" : ""}`}
          aria-pressed={activeFamiliarId == null}
          onClick={() => onFamiliarScopeChange(null)}
          title="All familiars"
        >
          <Icon name="ph:sparkle" width={13} aria-hidden />
          <span>All</span>
        </button>

        {familiars.map((f) => {
          const active = f.id === activeFamiliarId;
          return (
            <button
              key={f.id}
              type="button"
              data-id={f.id}
              style={{ ["--familiar-accent" as string]: f.color }}
              className={`familiar-dock__avatar${active ? " familiar-dock__avatar--active" : ""}`}
              aria-pressed={active}
              aria-label={`Filter by ${f.display_name}`}
              title={f.display_name}
              onClick={() => onFamiliarScopeChange(f.id)}
              onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}
            >
              <FamiliarAvatar familiar={f} size="sm" />
            </button>
          );
        })}

        <button
          type="button"
          className="familiar-dock__add"
          aria-label="Add familiar"
          title="Add familiar"
          onClick={() => openFamiliarStudioListView()}
        >
          <Icon name="ph:plus-bold" width={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
