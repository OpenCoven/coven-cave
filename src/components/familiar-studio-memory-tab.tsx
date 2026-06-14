"use client";

import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import { FamiliarsMemoryView } from "@/components/familiars-memory-view";

type Props = {
  familiar: ResolvedFamiliar;
  allFamiliars: Familiar[];
};

export function FamiliarStudioMemoryTab({ familiar, allFamiliars }: Props) {
  return (
    <FamiliarsMemoryView
      familiars={allFamiliars}
      activeFamiliar={familiar}
      lockToFamiliar
    />
  );
}
