"use client";

import { useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Icon } from "@/lib/icon";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { RelativeTime } from "@/components/ui/relative-time";
import { MarkdownBlock } from "@/components/message-bubble";
import { useMemoryFile } from "@/lib/use-memory-file";
import { classifyProtection } from "@/lib/memory-management";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  fileBase,
  fileDir,
  formatBytes,
  type FileMemoryEntry,
} from "@/components/familiars-memory-utils";

type MemoryFilesListProps = {
  entries: FileMemoryEntry[];
  onOpen?: (path: string) => void;
  loaded: boolean;
  error: string | null;
  limit?: number;
  className?: string;
  listClassName?: string;
  activeFamiliarId?: string | null;
  onSelect?: (rowId: string) => void;
  selectedRowId?: string | null;
  /** When set and entries exceed `limit`, render a footer button that reveals more. */
  onShowMore?: () => void;
  /** Soft-delete a file row by its full path. Structural entries hide the button. */
  onDelete?: (path: string) => void;
};

// ────────────────────────────────────────────────────────────────────────────
// MemoryReaderModal — fullscreen reader rendering a memory file's markdown
// via @create-markdown/preview (through MarkdownBlock).
// ────────────────────────────────────────────────────────────────────────────

type MemoryReaderModalProps = {
  path: string;
  title?: string;
  onClose: () => void;
};

export function MemoryReaderModal({ path, title, onClose }: MemoryReaderModalProps) {
  const { text, error } = useMemoryFile(path);
  const panelRef = useRef<HTMLDivElement>(null);
  // Trap focus inside the reader + Escape-to-close + restore focus to the opener.
  useFocusTrap(true, panelRef, { onEscape: onClose });

  const heading = title ?? path.split("/").pop() ?? "Memory";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Memory reader: ${heading}`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-[92vh] w-[94vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-panel)] shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
          <Icon name="ph:book-open" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-secondary)]" title={path}>
            {heading}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Close memory reader"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[820px]">
            {error ? (
              <p className="text-[length:var(--text-sm)] text-[var(--color-warning)]">{error}</p>
            ) : text === null ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading memory…</p>
            ) : (
              <MarkdownBlock text={text} className="cave-md--expanded" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExpandMemoryButton({
  path,
  title,
  variant = "default",
}: {
  path: string;
  title?: string;
  variant?: "default" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const compact = variant === "compact";
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="Expand memory to reader view"
        title="Expand to reader view"
        className={
          compact
            ? "focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            : "focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        }
      >
        <Icon name="ph:arrows-out-simple" width={compact ? 12 : 11} />
        {compact ? null : "Expand"}
      </button>
      {open ? <MemoryReaderModal path={path} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}


export function SourceFilterChip({
  label,
  count,
  active,
  onClick,
  help,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  /** One line saying what this source actually is — the three source names
   *  read as synonyms without it. */
  help?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={help}
      className={`focus-ring inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[length:var(--text-xs)] transition-colors ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]/50"
      }`}
    >
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--text-primary)]">{count}</span>
    </button>
  );
}

export function MemoryFilesList({
  entries,
  onOpen,
  loaded,
  error,
  limit,
  className,
  listClassName,
  activeFamiliarId,
  onSelect,
  selectedRowId,
  onShowMore,
  onDelete,
}: MemoryFilesListProps) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const sliced = entries.slice(0, limit ?? entries.length);
  const hidden = entries.length - sliced.length;
  return (
    <div
      className={[
        "rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25",
        className ?? "",
      ].join(" ")}
    >
      {sliced.length === 0 ? (
        !loaded ? (
          <SkeletonRows count={5} className="p-3" />
        ) : error ? (
          <div className="px-3 py-8 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
            Couldn't load memory files. See the error above and try again.
          </div>
        ) : (
          <EmptyState compact icon="ph:file-text" headline="No memory files match this view." />
        )
      ) : (
        <ul className={listClassName ?? "max-h-[640px] divide-y divide-[var(--border-hairline)] overflow-y-auto"}>
          {sliced.map((entry) => {
            const base = fileBase(entry.relPath);
            const dir = fileDir(entry.fullPath);
            const size = formatBytes(entry.size);
            return (
            <li
              key={entry.fullPath}
              className={`flex min-w-0 items-stretch gap-1 px-1 ${selectedRowId === `file:${entry.fullPath}` ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]"}`}
            >
              <button
                type="button"
                onClick={() => (onSelect ? onSelect(`file:${entry.fullPath}`) : onOpen?.(entry.fullPath))}
                className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
              >
                <Icon name="ph:file-text" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]" title={entry.relPath}>{base}</span>
                  <span className="mt-0.5 block truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {entry.sourceKindLabel}
                    {dir ? <> · {dir}</> : null}
                    {size ? <> · {size}</> : null}
                  </span>
                  {(entry.harnessId || entry.runtimeId || entry.origin || (entry.familiarId && entry.familiarId !== activeFamiliarId)) ? (
                    <span className="mt-1 flex flex-wrap gap-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                      {entry.origin ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">origin:{entry.origin}</span> : null}
                      {entry.harnessId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">runtime:{entry.harnessId}</span> : null}
                      {entry.runtimeId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">runtime:{entry.runtimeId}</span> : null}
                      {entry.familiarId && entry.familiarId !== activeFamiliarId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">familiar:{entry.familiarId}</span> : null}
                    </span>
                  ) : null}
                </span>
                <RelativeTime iso={entry.modified} className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]" />
              </button>
              <div className="flex items-center gap-1 pr-2">
                <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} variant="compact" />
                {onDelete && classifyProtection(entry.fullPath) !== "structural" ? (
                  <button
                    type="button"
                    className="memory-card-delete focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--color-warning)]"
                    aria-label={`Delete ${entry.relPath}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(entry.fullPath); }}
                  >
                    <Icon name="ph:trash" width={12} aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      {onShowMore && hidden > 0 ? (
        <button
          type="button"
          onClick={onShowMore}
          className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:caret-down" width={11} />
          Show {Math.min(hidden, 80)} more · {sliced.length} of {entries.length}
        </button>
      ) : null}
    </div>
  );
}
