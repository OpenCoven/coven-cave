"use client";

import type { ReactNode } from "react";
import { AutomationsView } from "@/components/lazy-surfaces";
import type { Escalation } from "@/lib/escalations-types";
import type { Familiar } from "@/lib/types";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";

type Props = {
  onOpenSource?: (item: Escalation) => void;
  familiars?: Familiar[];
  activeFamiliarId?: string | null;
  onNewReminder?: () => void;
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  onEditReminder?: (item: InboxItem) => void;
  onOpenLink?: (link: LinkRef) => void;
  defaultTab?: "escalations" | "schedules";
  /** Calendar surface rendered as the leading tab (merged schedule page). */
  calendarSlot?: ReactNode;
  /** Tab to open on mount — "calendar" deep-links the Calendar nav button. */
  initialTab?: "all" | "reminders" | "crons" | "flows" | "activity" | "calendar";
};

export function InboxEscalationsView({
  familiars,
  onNewReminder,
  onOpenSession,
  onEditReminder,
  onOpenLink,
  calendarSlot,
  initialTab,
}: Props) {
  return (
    <section className="h-full bg-background text-foreground">
      <AutomationsView
        familiars={familiars ?? []}
        onNewReminder={onNewReminder ?? (() => {})}
        onOpenSession={onOpenSession}
        onEdit={onEditReminder}
        onOpenLink={onOpenLink}
        calendarSlot={calendarSlot}
        initialTab={initialTab}
      />
    </section>
  );
}
