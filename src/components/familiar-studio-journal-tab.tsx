"use client";

import { useMemo } from "react";
import "@/styles/journal.css";
import { JournalEntries } from "@/components/journal/journal-entries";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

/**
 * Familiar Studio → Journal tab: the daily-reflection reader/editor scoped to
 * the familiar being edited. Reuses the full JournalEntries surface (day rail,
 * generate, edit/delete with undo) with the multiselect scope pinned to this
 * one familiar — the Journal's former top-level page redirects here.
 */
export function FamiliarStudioJournalTab({
  familiar,
  allFamiliars,
}: {
  familiar: ResolvedFamiliar;
  allFamiliars: Familiar[];
}) {
  const scope = useMemo(() => new Set([familiar.id]), [familiar.id]);
  return (
    <div className="familiar-studio-journal">
      <JournalEntries
        familiars={allFamiliars}
        activeFamiliarId={familiar.id}
        scopeFamiliarIds={scope}
      />
    </div>
  );
}
