"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { MarkdownBlock } from "@/components/message-bubble";
import { useMemoryFile } from "@/lib/use-memory-file";
import { MemoryMdEditor } from "@/components/md-editor/memory-md-editor";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import type { MemoryRow } from "@/lib/memory-rows";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

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
  // Edit mode swaps the reader body for the MemoryMdEditor (WYSIWYG/raw
  // markdown editing with mtime-guarded saves). `refreshToken` re-fetches the
  // read view after an edit session so it shows what was saved.
  const [editing, setEditing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // `contentPath` is the absolute, allow-listed path to fetch full content from — set
  // for files and for agent memories the server could resolve. When absent (e.g. an
  // agent memory with no resolvable file), fall back to the entry's `excerpt`.
  const fetchPath = row?.contentPath ?? null;
  const { text, error, loading } = useMemoryFile(fetchPath, { refreshToken });

  // Leaving a row ends its edit session — a new selection opens in read mode.
  useEffect(() => {
    setEditing(false);
  }, [fetchPath]);

  if (!row) {
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-8">
        <EmptyState
          icon="ph:book-open"
          headline="Select a memory to read"
          subtitle="Pick an entry on the left to view its contents."
        />
      </div>
    );
  }

  const copyPath = () => {
    void copyText(row.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // With a content path we render the fetched file; without one we render the excerpt.
  const hasFile = Boolean(row.contentPath);
  const content = hasFile ? text ?? "" : row.excerpt ?? "";
  const isFileLoading = hasFile && (loading || text === null);
  const fileError = hasFile ? error : null;
  const emptyMsg = hasFile ? "Empty file." : "No excerpt available.";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30">
      <div className="shrink-0 border-b border-[var(--border-hairline)] p-3">
        <div className="flex items-start justify-between gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to list"
              className="focus-ring mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] @min-[1024px]/memview:hidden"
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
            {hasFile ? (
              <button
                type="button"
                onClick={() => {
                  setEditing((prev) => {
                    if (prev) setRefreshToken((n) => n + 1);
                    return !prev;
                  });
                }}
                aria-pressed={editing}
                aria-label={editing ? "Stop editing" : "Edit memory file"}
                title={editing ? "Stop editing" : "Edit"}
                className={`focus-ring mr-1 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[10px] transition-colors ${
                  editing
                    ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon name="ph:pencil-simple" width={11} aria-hidden />
                {editing ? "Done" : "Edit"}
              </button>
            ) : null}
            {!editing ? (
            <>
            <div className="mr-1 inline-flex overflow-hidden rounded-md border border-[var(--border-hairline)] text-[10px]">
              {(["rendered", "raw"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`focus-ring-inset px-2 py-1 transition-colors ${
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
            </>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            {row.kind === "agent" ? "Familiar memory" : "File"}
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
          {row.contentPath ? (
            <button
              type="button"
              onClick={() => openGrimoireDoc("memory", row.contentPath!)}
              title="Open in the Grimoire editor"
              className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:book-open" width={11} aria-hidden />
              Grimoire
            </button>
          ) : null}
        </div>
      </div>
      {editing && row.contentPath ? (
        <div className="min-h-0 flex-1">
          <MemoryMdEditor
            path={row.contentPath}
            sourceLabel={row.sourceLabel}
            onCancel={() => {
              setEditing(false);
              setRefreshToken((n) => n + 1);
            }}
          />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {fileError ? (
          <ErrorState
            compact
            headline="Couldn't load this memory"
            subtitle={fileError}
          />
        ) : isFileLoading ? (
          <div className="space-y-2.5" aria-label="Loading memory" aria-busy="true">
            {["92%", "85%", "97%", "78%", "90%", "70%"].map((w, i) => (
              <Skeleton key={i} variant="text" width={w} />
            ))}
          </div>
        ) : content.trim() === "" ? (
          <p className="text-[12px] text-[var(--text-muted)]">{emptyMsg}</p>
        ) : mode === "rendered" ? (
          <MarkdownBlock text={content} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
            {content}
          </pre>
        )}
      </div>
      )}
    </div>
  );
}
