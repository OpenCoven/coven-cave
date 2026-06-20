import { ItemRow, SectionHead } from "@/components/daily-report-ui";
import type { InboxItem } from "@/lib/cave-inbox";

/**
 * Familiar updates that fired today (live). Hidden entirely when none — the
 * calm dashboard shouldn't render an empty section. Reuses the shared ItemRow
 * so updates deep-link back into the familiar's session.
 */
export function FamiliarUpdates({ items, now }: { items: InboxItem[]; now: Date }) {
  if (items.length === 0) return null;
  return (
    <section className="dr-section" aria-label="Familiar updates">
      <SectionHead icon="ph:sparkle" title="Familiar updates" count={items.length} />
      <div className="dr-list">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} now={now} />
        ))}
      </div>
    </section>
  );
}
