"use client";

import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export function ActingFamiliarGate({
  open,
  actionLabel,
  eligibleFamiliars,
  projectName,
  onChoose,
  onClose,
}: {
  open: boolean;
  actionLabel: string;
  eligibleFamiliars: ResolvedFamiliar[];
  projectName: string | null;
  onChoose: (familiarId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={[actionLabel, "Choose familiar"]}
      footerActions={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {eligibleFamiliars.length === 0 ? (
        <EmptyState
          icon="ph:user-circle"
          headline={
            projectName
              ? "No familiars have access to this project"
              : "No familiars are available"
          }
          subtitle={
            projectName
              ? `Manage access for ${projectName} before continuing.`
              : "Summon a familiar before continuing."
          }
        />
      ) : (
        <div className="flex flex-col gap-2" role="list" aria-label="Eligible familiars">
          {eligibleFamiliars.map((familiar) => (
            <div key={familiar.id} role="listitem">
              <Button
                variant="ghost"
                fullWidth
                className="justify-start"
                onClick={() => onChoose(familiar.id)}
              >
                <FamiliarAvatar familiar={familiar} size="sm" />
                <span>{familiar.display_name}</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
