"use client";

import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import { AgentsMemoryView } from "@/components/agents-memory-view";

type Props = {
  familiar: ResolvedFamiliar;
  allFamiliars: Familiar[];
};

export function FamiliarStudioMemoryTab({ familiar, allFamiliars }: Props) {
  return (
    <AgentsMemoryView
      familiars={allFamiliars}
      activeFamiliar={familiar}
      lockToFamiliar
    />
  );
}
