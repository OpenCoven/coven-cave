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
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar | null;
  allResolved: ResolvedFamiliar[];
};

export function FamiliarStudioLifecycleTab({ familiar, allResolved }: Props) {
  const archived = useArchivedFamiliars();
  const { openFamiliarStudio } = useFamiliarStudio();
  const [confirmReset, setConfirmReset] = useState(false);

  // The full roster (active + archived) with reorder + archive — this is the
  // manager that used to live in the standalone "Manage familiars" page. It now
  // renders here so Settings → Familiars is the single source of truth, with the
  // selected familiar's per-familiar controls (reset) below it.
  const active = allResolved.filter((f) => !(f.id in archived));
  const archivedList = allResolved.filter((f) => f.id in archived);

  function move(id: string, direction: "up" | "down") {
    const ids = allResolved.map((f) => f.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    // Only swap within the active group — refuse to move past an archived neighbor.
    const swapId = ids[swapIdx];
    if (swapId in archived) return;
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    setFamiliarOrder(ids);
  }

  function resetAll() {
    if (!familiar) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearAllFamiliarOverrides(familiar.id);
    clearGlyphOverride(familiar.id);
    void clearFamiliarImage(familiar.id);
    void fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [familiar.id]: null } }),
    });
    setConfirmReset(false);
  }

  return (
    <div className="familiar-studio-lifecycle">
      <section>
        <h3 className="familiar-studio-lifecycle__heading">Active</h3>
        {active.map((f, i) => (
          <FamiliarRow
            key={f.id}
            familiar={f}
            isArchived={false}
            canMoveUp={i > 0}
            canMoveDown={i < active.length - 1}
            onSelect={() => openFamiliarStudio(f.id, "identity")}
            onArchive={() => archiveFamiliar(f.id)}
            onUnarchive={() => unarchiveFamiliar(f.id)}
            onMoveUp={() => move(f.id, "up")}
            onMoveDown={() => move(f.id, "down")}
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
              canMoveUp={false}
              canMoveDown={false}
              onSelect={() => openFamiliarStudio(f.id, "identity")}
              onArchive={() => archiveFamiliar(f.id)}
              onUnarchive={() => unarchiveFamiliar(f.id)}
              onMoveUp={() => { /* no-op */ }}
              onMoveDown={() => { /* no-op */ }}
            />
          ))}
        </section>
      ) : null}

      {familiar ? (
        <section className="familiar-studio-lifecycle__section">
          <h3 className="familiar-studio-lifecycle__heading">Reset overrides</h3>
          <p className="familiar-studio-lifecycle__hint">
            Clears {familiar.display_name}&apos;s identity / look / brain customizations and
            reverts it to its daemon defaults.
          </p>
          <button
            onClick={resetAll}
            className={`familiar-studio-lifecycle__btn familiar-studio-lifecycle__btn--danger${confirmReset ? " familiar-studio-lifecycle__btn--confirm" : ""}`}
          >
            <Icon name="ph:trash" width={14} />
            {confirmReset ? "Click again to confirm" : "Reset all overrides"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function FamiliarRow({
  familiar,
  isArchived,
  canMoveUp,
  canMoveDown,
  onSelect,
  onArchive,
  onUnarchive,
  onMoveUp,
  onMoveDown,
}: {
  familiar: ResolvedFamiliar;
  isArchived: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="familiar-studio-lifecycle__row">
      <button type="button" onClick={onSelect} className="familiar-studio-lifecycle__row-main">
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span>{familiar.display_name}</span>
      </button>
      {!isArchived ? (
        <>
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`Move ${familiar.display_name} up`}
            className="familiar-studio-lifecycle__row-action"
          >
            <Icon name="ph:arrow-up-bold" width={12} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`Move ${familiar.display_name} down`}
            className="familiar-studio-lifecycle__row-action"
          >
            <Icon name="ph:arrow-down-bold" width={12} />
          </button>
        </>
      ) : null}
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
