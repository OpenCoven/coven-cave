"use client";

import { AutomationsView } from "@/components/automations-view";
import type { Escalation } from "@/lib/escalations-types";
import type { Familiar } from "@/lib/types";

type Props = {
  onOpenSource?: (item: Escalation) => void;
  familiars?: Familiar[];
  activeFamiliarId?: string | null;
  onNewReminder?: () => void;
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  defaultTab?: "escalations" | "schedules";
};

export function InboxEscalationsView({
  familiars,
  onNewReminder,
  onOpenSession,
}: Props) {
  return (
    <section className="h-full bg-background text-foreground">
      <AutomationsView
        familiars={familiars ?? []}
        onNewReminder={onNewReminder ?? (() => {})}
        onOpenSession={onOpenSession}
      />
    </section>
  );
}
