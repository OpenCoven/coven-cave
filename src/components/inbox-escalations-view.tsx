"use client";

import type { ReactNode } from "react";
import { AutomationsView } from "@/components/lazy-surfaces";
import type { Familiar } from "@/lib/types";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";

type Props = {
  familiars?: Familiar[];
  onNewReminder?: () => void;
  onEditReminder?: (item: InboxItem) => void;
  onOpenLink?: (link: LinkRef) => void;
  /** Calendar surface rendered as the leading tab (merged schedule page). */
  calendarSlot?: ReactNode;
  /** Tab to open on mount — "calendar" deep-links the Calendar nav button. */
  initialTab?: "overview" | "calendar" | "crons";
};

export function InboxEscalationsView({
  familiars,
  onNewReminder,
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
        onEdit={onEditReminder}
        onOpenLink={onOpenLink}
        calendarSlot={calendarSlot}
        initialTab={initialTab}
      />
    </section>
  );
}
