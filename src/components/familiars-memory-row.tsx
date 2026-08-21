"use client";
import { Icon } from "@/lib/icon";
import type {
  CanonicalMemoryRow,
  FileMemoryRow,
} from "@/lib/memory-rows";

function formatBytes(n: number | undefined): string {
  if (!n || n < 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type MemoryRowItemProps = {
  age: string;
  selected: boolean;
  onSelect: () => void;
  onExpand: () => void;
} & (
  | { row: CanonicalMemoryRow; onDelete?: never }
  | { row: FileMemoryRow; onDelete?: () => void }
);

export function MemoryRowItem({
  row,
  age,
  selected,
  onSelect,
  onExpand,
  onDelete,
}: MemoryRowItemProps) {
  const size = row.kind === "file" ? formatBytes(row.size) : "";
  return (
    <li
      className={`fm-memory-row group/row relative flex min-w-0 items-stretch gap-1 transition-colors ${
        selected
          ? "is-selected"
          : ""
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="fm-memory-row__main focus-ring-inset flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span className="fm-memory-row__provenance" data-kind={row.kind}>
          <Icon
            name={row.kind === "canonical" ? "ph:brain" : "ph:file-text"}
            width={13}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="fm-memory-row__title block min-w-0 flex-1 truncate" title={row.title}>
              {row.title}
            </span>
            <span className="fm-memory-row__age shrink-0">{age}</span>
          </span>
          <span className="fm-memory-row__meta">
            <span className="truncate">{row.sourceLabel}</span>
            {row.kind === "canonical" ? (
              <>
                <span aria-hidden>·</span>
                <span>{row.verification.state}</span>
                <span aria-hidden>·</span>
                <span>{row.privacy.classification ?? "unclassified"}</span>
              </>
            ) : null}
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
      <div className="fm-memory-row__actions touch-always-visible flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand ${row.title} to reader view`}
          title="Expand to reader view"
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrows-out-simple" width={12} aria-hidden />
        </button>
        {row.kind === "file" && onDelete && row.protection !== "structural" ? (
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
