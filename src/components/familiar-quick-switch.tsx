"use client";

import { FamiliarSwitcher } from "@/components/familiar-switcher";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** `null` scopes to "All familiars". */
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  /** Menu placement of the switcher. */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Labels the switcher's trigger with the active familiar name. */
  labeled?: boolean;
};

/**
 * Familiar selection is dropdown-only: the one-tap avatar strip (and its
 * avatars/dropdown style preference) is retired, so this is a thin wrapper
 * around the full {@link FamiliarSwitcher} menu kept for its remaining call
 * sites (the mobile top bar). On desktop, familiar selection lives in the
 * chat sidebar's header switcher.
 */
export function FamiliarQuickSwitch({
  familiars,
  activeFamiliarId,
  sessions,
  responseNeeded,
  onSelectFamiliar,
  placement = "bottom-start",
  labeled = false,
}: Props) {
  return (
    <div className="familiar-quickswitch">
      <FamiliarSwitcher
        familiars={familiars}
        activeFamiliarId={activeFamiliarId}
        sessions={sessions}
        responseNeeded={responseNeeded}
        onSelectFamiliar={onSelectFamiliar}
        placement={placement}
        labeled={labeled}
      />
    </div>
  );
}
