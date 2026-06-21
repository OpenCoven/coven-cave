"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { formatDate } from "@/lib/datetime-format";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { LibraryCollection, LibraryDoc } from "@/lib/library-types";

type Props = {
  docs: LibraryDoc[];
  selectedId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (doc: LibraryDoc) => void;
  loading: boolean;
  collections?: LibraryCollection[];
  activeCollection?: string;
  onRenameMove?: (doc: LibraryDoc, patch: { title?: string; collection?: string }) => Promise<void>;
  /** Error message from the last load attempt, if any. */
  error?: string | null;
  /** Triggered when the user clicks Retry in the error state. */
  onRetry?: () => void;
};

function relDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  // Older than a week → date-pref-aware absolute date; recent → the shared
  // compact relative time so every Library tab reads identically.
  if (Date.now() - then >= 7 * 86_400_000) return formatDate(iso);
  return relativeTime(iso);
}

function filterDocs(docs: LibraryDoc[], query: string): LibraryDoc[] {
  if (!query.trim()) return docs;
  const q = query.toLowerCase();
  return docs.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.excerpt.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function LibraryDocList({
  docs,
  selectedId,
  searchQuery,
  onSearchChange,
  onSelect,
  loading,
  collections = [],
  activeCollection = "all",
  onRenameMove,
  error,
  onRetry,
}: Props) {
  const filtered = useMemo(() => filterDocs(docs, searchQuery), [docs, searchQuery]);
  const movableCollections = useMemo(() => collections.filter((collection) => collection.id !== "all"), [collections]);
  const movableCollectionIds = useMemo(() => new Set(movableCollections.map((c) => c.id)), [movableCollections]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ docId: string; message: string } | null>(null);

  function startRename(doc: LibraryDoc) {
    setEditingId(doc.id);
    setDraftTitle(doc.title);
    setActionError(null);
  }

  function cancelRename() {
    setEditingId(null);
    setDraftTitle("");
  }

  async function commitRename(doc: LibraryDoc) {
    const title = draftTitle.trim();
    if (!title || !onRenameMove) return;
    setBusyId(doc.id);
    setActionError(null);
    try {
      await onRenameMove(doc, { title });
      cancelRename();
    } catch (err) {
      setActionError({ docId: doc.id, message: err instanceof Error ? err.message : "Could not rename file." });
    } finally {
      setBusyId(null);
    }
  }

  async function moveDoc(doc: LibraryDoc, collection: string) {
    if (!collection || !onRenameMove) return;
    setBusyId(doc.id);
    setActionError(null);
    try {
      await onRenameMove(doc, { collection });
    } catch (err) {
      setActionError({ docId: doc.id, message: err instanceof Error ? err.message : "Could not move file." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="library-doclist">
      {/* Search bar */}
      <div className="library-doclist-search">
        <Icon name="ph:magnifying-glass" width={13} className="library-doclist-search-icon" />
        <input
          type="text"
          className="library-doclist-search-input"
          placeholder="Search documents…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          spellCheck={false}
          aria-label="Search documents"
        />
        {searchQuery && (
          <button
            type="button"
            className="library-doclist-search-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
          >
            <Icon name="ph:x" width={11} />
          </button>
        )}
      </div>

      {/* List */}
      <div className="library-doclist-items">
        {loading ? (
          <SkeletonRows count={5} className="library-doclist-skeleton" />
        ) : error ? (
          <ErrorState
            icon="ph:warning-circle"
            headline={<>Couldn&rsquo;t load documents.</>}
            subtitle={error}
            actions={
              onRetry ? (
                <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="ph:books"
            headline={searchQuery ? "No documents match your search." : "No documents yet."}
            subtitle={
              searchQuery
                ? "Try a shorter query or clear the search."
                : "Documents your familiars collect or you import will appear here."
            }
          />
        ) : (
          filtered.map((doc) => {
            const isEditing = editingId === doc.id;
            const isBusy = busyId === doc.id;
            const moveValue = movableCollectionIds.has(doc.collection)
              ? doc.collection
              : "";
            return (
              <div
                key={doc.id}
                className={`library-doclist-item${doc.id === selectedId ? " library-doclist-item--active" : ""}`}
              >
                <button
                  type="button"
                  className="library-doclist-item-main"
                  onClick={() => onSelect(doc)}
                >
                  <div className="library-doclist-item-header">
                    <span className="library-doclist-item-title">{doc.title}</span>
                    <span className="library-doclist-item-date">{relDate(doc.modifiedAt)}</span>
                  </div>
                  <div className="library-doclist-item-meta">
                    <Icon name="ph:robot" width={12} className="library-doclist-item-familiar shrink-0 text-[var(--text-muted)]" />
                    {doc.excerpt && (
                      <span className="library-doclist-item-excerpt">{doc.excerpt}</span>
                    )}
                  </div>
                  {doc.tags.length > 0 && (
                    <div className="library-doclist-item-tags">
                      {doc.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="library-doclist-tag">
                          {tag}
                        </span>
                      ))}
                      {doc.tags.length > 4 && <span className="board-table-muted">+{doc.tags.length - 4}</span>}
                    </div>
                  )}
                </button>
                {onRenameMove && (
                  <div className="library-doclist-item-actions">
                    <button
                      type="button"
                      className="library-doclist-file-action"
                      onClick={() => startRename(doc)}
                      disabled={isBusy}
                      aria-label={`Rename ${doc.title}`}
                      title="Rename file"
                    >
                      <Icon name="ph:pencil-simple" width={12} />
                    </button>
                    <label className="library-doclist-move">
                      <Icon name="ph:folder" width={12} aria-hidden />
                      <select
                        value={moveValue}
                        onChange={(event) => { void moveDoc(doc, event.target.value); }}
                        disabled={isBusy || movableCollections.length === 0}
                        aria-label={`Move ${doc.title}`}
                        title="Move file"
                      >
                        <option value="" disabled>{activeCollection === "all" ? "Move" : "Folder"}</option>
                        {movableCollections.map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {isEditing && (
                  <form
                    className="library-doclist-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void commitRename(doc);
                    }}
                  >
                    <input
                      className="library-doclist-rename-input"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelRename();
                      }}
                      aria-label={`New name for ${doc.title}`}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="library-doclist-file-action library-doclist-file-action--primary"
                      disabled={isBusy || !draftTitle.trim()}
                      aria-label={`Save rename for ${doc.title}`}
                    >
                      <Icon name="ph:check" width={12} />
                    </button>
                    <button
                      type="button"
                      className="library-doclist-file-action"
                      onClick={cancelRename}
                      disabled={isBusy}
                      aria-label={`Cancel rename for ${doc.title}`}
                    >
                      <Icon name="ph:x" width={12} />
                    </button>
                  </form>
                )}
                {actionError?.docId === doc.id && (
                  <div className="library-doclist-action-error" role="alert">{actionError.message}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
