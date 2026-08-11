"use client";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { DocumentReader } from "@/components/document-reader";
import { MarkdownReaderBlock } from "@/components/canonical-memory-markdown";
import { useMemoryFile } from "@/lib/use-memory-file";
import { MemoryMdEditor } from "@/components/md-editor/memory-md-editor";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import type { FileMemoryRow } from "@/lib/memory-rows";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { parseMarkdownReaderDocument } from "@/lib/document-reader";

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
  row: FileMemoryRow | null;
  age: string;
  sizeLabel: string;
  onOpenFile: (path: string) => void;
  onExpand: (row: FileMemoryRow) => void;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  const [copied, setCopied] = useState(false);
  // Edit mode swaps the reader body for the MemoryMdEditor (WYSIWYG/raw
  // markdown editing with mtime-guarded saves). `refreshToken` re-fetches the
  // read view after an edit session so it shows what was saved.
  const [editing, setEditing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // File rows always carry the absolute allow-listed content path.
  const fetchPath = row?.contentPath ?? null;
  const { text, error, loading } = useMemoryFile(fetchPath, { refreshToken });
  const content = text ?? "";
  const readerDocument = useMemo(
    () => parseMarkdownReaderDocument(content, row?.title ?? "Memory"),
    [content, row?.title],
  );

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

  const isFileLoading = loading || text === null;
  const fileError = error;

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
            className="min-w-0 flex-1 truncate text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]"
            title={row.title}
          >
            {row.title}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setEditing((previous) => {
                  if (previous) setRefreshToken((current) => current + 1);
                  return !previous;
                });
              }}
              aria-pressed={editing}
              aria-label={editing ? "Stop editing" : "Edit memory file"}
              title={editing ? "Stop editing" : "Edit"}
              className={`focus-ring mr-1 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-2xs)] transition-colors ${
                editing
                  ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon name="ph:pencil-simple" width={11} aria-hidden />
              {editing ? "Done" : "Edit"}
            </button>
            {!editing ? (
              <>
                <div className="mr-1 inline-flex overflow-hidden rounded-md border border-[var(--border-hairline)] text-[length:var(--text-2xs)]">
                  {(["rendered", "raw"] as const).map((nextMode) => (
                    <button
                      key={nextMode}
                      type="button"
                      aria-pressed={mode === nextMode}
                      onClick={() => setMode(nextMode)}
                      className={`focus-ring-inset px-2 py-1 transition-colors ${
                        mode === nextMode
                          ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                      }`}
                    >
                      {nextMode === "rendered" ? "Rendered" : "Raw"}
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
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            File
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
            className="min-w-0 flex-1 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]"
            title={row.path}
          >
            {compactPath(row.path)}
          </code>
          <button
            type="button"
            onClick={copyPath}
            aria-label="Copy path"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded px-1.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:copy" width={11} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => onOpenFile(row.path)}
            className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:file-text" width={11} aria-hidden />
            Open file
          </button>
          <button
            type="button"
            onClick={() => openGrimoireDoc("memory", row.contentPath)}
            title="Open in the Memories editor"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:book-open" width={11} aria-hidden />
            Memories
          </button>
        </div>
      </div>
      {editing ? (
        <div className="min-h-0 flex-1">
          <MemoryMdEditor
            path={row.contentPath}
            sourceLabel={row.sourceLabel}
            onCancel={() => {
              setEditing(false);
              setRefreshToken((current) => current + 1);
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {fileError ? (
            <div className="p-4">
              <ErrorState
                compact
                headline="Couldn't load this memory"
                subtitle={fileError}
              />
            </div>
          ) : isFileLoading ? (
            <div
              className="space-y-2.5 p-4"
              aria-label="Loading memory"
              aria-busy="true"
            >
              {["92%", "85%", "97%", "78%", "90%", "70%"].map(
                (width, index) => (
                  <Skeleton key={index} variant="text" width={width} />
                ),
              )}
            </div>
          ) : content.trim() === "" ? (
            <p className="p-4 text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Empty file.
            </p>
          ) : mode === "rendered" ? (
            <DocumentReader
              document={readerDocument}
              navigation="compact"
              renderLede={(block) => (
                <MarkdownReaderBlock block={block} blockKey="memory-lede" />
              )}
              renderBlock={(block, key) => (
                <MarkdownReaderBlock block={block} blockKey={key} />
              )}
            />
          ) : (
            <pre className="h-full overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-[length:var(--text-xs)] leading-5 text-[var(--text-secondary)]">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
