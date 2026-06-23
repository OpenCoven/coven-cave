"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";
import { RelativeTime } from "@/components/ui/relative-time";

function listIcon(list: TimelineEntry["list"]): IconName {
  if (list === "github") return "ph:github-logo";
  if (list === "reading") return "ph:book-open";
  return "ph:bookmark-simple";
}

function EntryIcon({ entry }: { entry: TimelineEntry }) {
  return (
    <Icon
      name={listIcon(entry.list)}
      width={15}
      className="text-[var(--text-muted)]"
      aria-hidden
    />
  );
}

export function LibraryTimelineRow({
  entry,
  familiars,
  selected,
  onSelect,
}: {
  entry: TimelineEntry;
  familiars: Familiar[];
  selected: boolean;
  onSelect: () => void;
}) {
  const fam = familiars.find((f) => f.id === entry.familiar);
  const title = entry.item.title || (entry.item as { url?: string }).url || "Untitled";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`library-timeline-row focus-ring-inset flex w-full items-center gap-3 text-left ${
        selected
          ? "library-timeline-row--selected"
          : ""
      }`}
      aria-current={selected ? "true" : undefined}
    >
      {/* list icon */}
      <span className="library-timeline-row-icon flex shrink-0 items-center justify-center">
        <EntryIcon entry={entry} />
      </span>

      {/* title + familiar */}
      <span className="min-w-0 flex-1">
        <span className="library-timeline-row-title block truncate">
          {title}
        </span>
        {fam && (
          <span className="library-timeline-row-meta block truncate">
            {fam.display_name}
          </span>
        )}
      </span>

      {/* recency */}
      <RelativeTime iso={entry.capturedAt} className="library-timeline-row-time shrink-0 tabular-nums" />
    </button>
  );
}
