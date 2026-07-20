import { Icon } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";

/** Visual and accessible status marker shared by Rituals feed rows. */
export function StatusIcon({ item }: { item: InboxItem }) {
  const paused = item.status === "dismissed" && item.recurrence?.type !== "none";
  const active = item.status === "pending" || item.status === "fired";
  const hasRun = !!item.firedAt;

  if (paused) {
    return (
      <span role="img" aria-label="Paused" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border [border-color:rgba(255,255,255,0.18)]! [color:rgba(255,255,255,0.35)]!">
        <Icon name="ph:minus" width={8} />
      </span>
    );
  }
  if (active && hasRun) {
    return <span role="img" aria-label="Active, has fired" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full [background:var(--accent-presence)]!" />;
  }
  return <span role="img" aria-label="Active, not fired yet" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border [border-color:rgba(255,255,255,0.28)]!" />;
}
