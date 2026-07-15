"use client";
import { Icon } from "@/lib/icon";
import type { MemoryRow } from "@/lib/memory-rows";

function formatBytes(n: number | undefined): string {
  if (!n || n < 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MemoryRowItem({
  row,
  age,
  selected,
  onSelect,
  onExpand,
  onDelete,
}: {
  row: MemoryRow;
  age: string;
  selected: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onDelete?: () => void;
}) {
  const size = formatBytes(row.size);
  return (
    <li
      className={`group/row relative flex min-w-0 items-stretch gap-1 border-l-2 px-1 transition-colors ${
        selected
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)]/60"
          : "border-transparent hover:bg-[var(--bg-raised)]"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
      >
        <Icon
          name={row.kind === "agent" ? "ph:brain" : "ph:file-text"}
          width={13}
          className="mt-0.5 shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]" title={row.title}>
              {row.title}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="truncate">{row.sourceLabel}</span>
            {size ? <><span aria-hidden>·</span><span>{size}</span></> : null}
            {row.stale ? (
              <span className="inline-flex items-center gap-1" title="Stale — suggested for cleanup">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
                <span className="sr-only">stale</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <div className="touch-always-visible flex items-center gap-1 pr-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand ${row.title} to reader view`}
          title="Expand to reader view"
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrows-out-simple" width={12} aria-hidden />
        </button>
        {onDelete && row.protection !== "structural" ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${row.title}`}
            className="memory-card-delete focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--color-warning)]"
          >
            <Icon name="ph:trash" width={12} aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}
