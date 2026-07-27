"use client";

import { useState } from "react";

import { FamiliarDailyNotes } from "@/components/familiar-daily-notes";
import { FamiliarsMemoryView } from "@/components/familiars-memory-view";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

type Props = {
  familiar: ResolvedFamiliar;
  allFamiliars: Familiar[];
  localDaemonReady: boolean;
};

export function FamiliarStudioMemoryTab({
  familiar,
  allFamiliars,
  localDaemonReady,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <>
      <div className="familiar-studio-memory">
        <div className="familiar-studio-memory__toolbar">
          <p>Browse durable memory and add a dated note for {familiar.display_name}.</p>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:plus"
            onClick={() => setNoteOpen(true)}
          >
            Add note
          </Button>
        </div>
        <FamiliarsMemoryView
          familiars={allFamiliars}
          activeFamiliar={familiar}
          localDaemonReady={localDaemonReady}
          lockToFamiliar
        />
      </div>

      <Modal
        open={noteOpen}
        wide
        onClose={() => setNoteOpen(false)}
        breadcrumb={["Familiars", familiar.display_name, "Add note"]}
        footerActions={(
          <Button variant="secondary" onClick={() => setNoteOpen(false)}>
            Close
          </Button>
        )}
      >
        <div className="familiar-studio-note-editor">
          <FamiliarDailyNotes familiar={familiar} />
        </div>
      </Modal>
    </>
  );
}
