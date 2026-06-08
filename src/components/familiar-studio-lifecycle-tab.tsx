"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import {
  archiveFamiliar,
  unarchiveFamiliar,
  useArchivedFamiliars,
} from "@/lib/cave-familiar-archive";
import { clearAllFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { clearGlyphOverride } from "@/lib/cave-glyph-overrides";
import { clearFamiliarImage } from "@/lib/cave-familiar-images";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar | null;
  allResolved: ResolvedFamiliar[];
};

export function FamiliarStudioLifecycleTab({ familiar, allResolved }: Props) {
  const archived = useArchivedFamiliars();
  const { openFamiliarStudio, listView } = useFamiliarStudio();
  const [confirmReset, setConfirmReset] = useState(false);

  if (listView) {
    const active = allResolved.filter((f) => !(f.id in archived));
    const archivedList = allResolved.filter((f) => f.id in archived);
    return (
      <div className="familiar-studio-lifecycle">
        <section>
          <h3 className="familiar-studio-lifecycle__heading">Active</h3>
          {active.map((f) => (
            <FamiliarRow
              key={f.id}
              familiar={f}
              isArchived={false}
              onSelect={() => openFamiliarStudio(f.id, "identity")}
              onArchive={() => archiveFamiliar(f.id)}
              onUnarchive={() => unarchiveFamiliar(f.id)}
            />
          ))}
        </section>
        {archivedList.length > 0 ? (
          <section>
            <h3 className="familiar-studio-lifecycle__heading">Archived</h3>
            {archivedList.map((f) => (
              <FamiliarRow
                key={f.id}
                familiar={f}
                isArchived={true}
                onSelect={() => openFamiliarStudio(f.id, "identity")}
                onArchive={() => archiveFamiliar(f.id)}
                onUnarchive={() => unarchiveFamiliar(f.id)}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  if (!familiar) return null;

  const isArchived = familiar.id in archived;

  function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearAllFamiliarOverrides(familiar!.id);
    clearGlyphOverride(familiar!.id);
    clearFamiliarImage(familiar!.id);
    void fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [familiar!.id]: {} } }),
    });
    setConfirmReset(false);
  }

  return (
    <div className="familiar-studio-lifecycle">
      <section className="familiar-studio-lifecycle__section">
        <h3 className="familiar-studio-lifecycle__heading">Archive</h3>
        <p className="familiar-studio-lifecycle__hint">
          Archived familiars are hidden from the rail and switchers but remain
          in this Studio&apos;s list view.
        </p>
        {isArchived ? (
          <button onClick={() => unarchiveFamiliar(familiar.id)} className="familiar-studio-lifecycle__btn">
            <Icon name="ph:arrow-counter-clockwise" width={14} /> Unarchive
          </button>
        ) : (
          <button onClick={() => archiveFamiliar(familiar.id)} className="familiar-studio-lifecycle__btn">
            <Icon name="ph:archive" width={14} /> Archive
          </button>
        )}
      </section>

      <section className="familiar-studio-lifecycle__section">
        <h3 className="familiar-studio-lifecycle__heading">Reset overrides</h3>
        <p className="familiar-studio-lifecycle__hint">
          Clears identity / look / brain customizations and reverts this
          familiar to its daemon defaults.
        </p>
        <button
          onClick={resetAll}
          className={`familiar-studio-lifecycle__btn familiar-studio-lifecycle__btn--danger${confirmReset ? " familiar-studio-lifecycle__btn--confirm" : ""}`}
        >
          <Icon name="ph:trash" width={14} />
          {confirmReset ? "Click again to confirm" : "Reset all overrides"}
        </button>
      </section>
    </div>
  );
}

function FamiliarRow({
  familiar,
  isArchived,
  onSelect,
  onArchive,
  onUnarchive,
}: {
  familiar: ResolvedFamiliar;
  isArchived: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  return (
    <div className="familiar-studio-lifecycle__row">
      <button type="button" onClick={onSelect} className="familiar-studio-lifecycle__row-main">
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span>{familiar.display_name}</span>
      </button>
      {isArchived ? (
        <button onClick={onUnarchive} aria-label="Unarchive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:arrow-counter-clockwise" width={12} />
        </button>
      ) : (
        <button onClick={onArchive} aria-label="Archive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:archive" width={12} />
        </button>
      )}
    </div>
  );
}
