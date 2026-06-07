"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";

function listIcon(list: TimelineEntry["list"]): IconName {
  if (list === "github") return "ph:github-logo";
  if (list === "reading") return "ph:book-open";
  return "ph:bookmark-simple";
}

function ruleLabel(entry: TimelineEntry, familiars: Familiar[]): string {
  const rule = entry.item.capture?.classifier?.rule;
  if (!rule) return "manual";
  if (rule === "familiar-fallback") {
    const fam = familiars.find((f) => f.id === entry.familiar);
    return `${fam?.display_name ?? "Familiar"} guessed`;
  }
  return rule;
}

function sourcePillText(entry: TimelineEntry): string | null {
  const s = entry.source;
  if (!s) return null;
  if (s.kind === "chat") return `chat "${s.chatTitle}"`;
  if (s.kind === "browser") return "Save button";
  if (s.kind === "slash") return s.originSessionId ? "/save in chat" : "/save";
  if (s.kind === "feed") return `RSS · ${s.feedTitle}`;
  return null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
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
  const pill = sourcePillText(entry);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring-inset grid w-full grid-cols-[24px_1fr_auto_auto] items-center gap-3 border-l-2 px-3 py-2 text-left text-[12px] transition-colors ${
        selected
          ? "border-l-[var(--accent-presence)] bg-[var(--bg-hover)]"
          : "border-l-transparent hover:bg-[var(--bg-hover)]"
      }`}
      aria-current={selected ? "true" : undefined}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-primary)]">
        <Icon name={listIcon(entry.list)} width={14} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[var(--text-primary)]">
          {entry.item.title || entry.item.url}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          {fam ? <span>{fam.display_name}</span> : null}
          {pill ? (
            <>
              {fam ? <span aria-hidden>·</span> : null}
              <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[var(--accent-presence)]">
                {pill}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
        {ruleLabel(entry, familiars)}
      </span>
      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
        {relTime(entry.capturedAt)}
      </span>
    </button>
  );
}
