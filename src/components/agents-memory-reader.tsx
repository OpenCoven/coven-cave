"use client";
import { useState } from "react";
import { Icon } from "@/lib/icon";
import { MarkdownBlock } from "@/components/message-bubble";
import { useMemoryFile } from "@/lib/use-memory-file";
import type { MemoryRow } from "@/lib/memory-rows";

function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  if (collapsed.length <= 52) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith("~") ? "~" : `/${segments[0]}`;
  return `${first}/…/${segments.slice(-3).join("/")}`;
}

export function MemoryReaderPane({
  row,
  age,
  sizeLabel,
  onOpenFile,
  onExpand,
  onBack,
}: {
  row: MemoryRow | null;
  age: string;
  sizeLabel: string;
  onOpenFile: (path: string) => void;
  onExpand: (row: MemoryRow) => void;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  const [copied, setCopied] = useState(false);
  const { text, error, loading } = useMemoryFile(row?.path ?? null);

  if (!row) {
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-8 text-center">
        <div>
          <Icon name="ph:book-open" width={24} className="mx-auto text-[var(--text-muted)]" aria-hidden />
          <p className="mt-3 text-[13px] font-medium text-[var(--text-primary)]">Select a memory to read</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Pick an entry on the left to view its contents.</p>
        </div>
      </div>
    );
  }

  const copyPath = () => {
    void navigator.clipboard.writeText(row.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30">
      <div className="shrink-0 border-b border-[var(--border-hairline)] p-3">
        <div className="flex items-start justify-between gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to list"
              className="focus-ring mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] xl:hidden"
            >
              <Icon name="ph:arrow-left" width={13} aria-hidden />
            </button>
          ) : null}
          <h3
            className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text-primary)]"
            title={row.title}
          >
            {row.title}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <div className="mr-1 inline-flex overflow-hidden rounded-md border border-[var(--border-hairline)] text-[10px]">
              {(["rendered", "raw"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 transition-colors ${
                    mode === m
                      ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {m === "rendered" ? "Rendered" : "Raw"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onExpand(row)}
              aria-label="Expand to fullscreen reader"
              title="Fullscreen"
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrows-out-simple" width={12} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            {row.kind === "agent" ? "Agent memory" : "File"}
          </span>
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{row.sourceLabel}</span>
          {sizeLabel ? (
            <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{sizeLabel}</span>
          ) : null}
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age}</span>
          {row.stale ? (
            <span className="rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[var(--color-warning)]">
              Stale
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-1">
          <code
            className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]"
            title={row.path}
          >
            {compactPath(row.path)}
          </code>
          <button
            type="button"
            onClick={copyPath}
            aria-label="Copy path"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:copy" width={11} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => onOpenFile(row.path)}
            className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:file-text" width={11} aria-hidden />
            Open file
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
        ) : loading || text === null ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading memory…</p>
        ) : text.trim() === "" ? (
          <p className="text-[12px] text-[var(--text-muted)]">Empty file.</p>
        ) : mode === "rendered" ? (
          <MarkdownBlock text={text} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
