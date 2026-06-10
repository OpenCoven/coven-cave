"use client";

import { Icon } from "@/lib/icon";
import type { LibraryDoc } from "@/lib/library-types";

type Props = {
  docs: LibraryDoc[];
  selectedId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (doc: LibraryDoc) => void;
  loading: boolean;
  /** Error message from the last load attempt, if any. */
  error?: string | null;
  /** Triggered when the user clicks Retry in the error state. */
  onRetry?: () => void;
};

const relDateFmt = new Intl.RelativeTimeFormat([], { numeric: "auto" });

function relDate(iso: string): string {
  try {
    const diff = new Date(iso).getTime() - Date.now();
    const absDiff = Math.abs(diff);
    if (absDiff < 60_000) return "just now";
    if (absDiff < 3_600_000) return relDateFmt.format(Math.round(diff / 60_000), "minutes");
    if (absDiff < 86_400_000) return relDateFmt.format(Math.round(diff / 3_600_000), "hours");
    if (absDiff < 86_400_000 * 30) return relDateFmt.format(Math.round(diff / 86_400_000), "days");
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
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
  error,
  onRetry,
}: Props) {
  const filtered = filterDocs(docs, searchQuery);

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
          <div className="library-doclist-empty">Loading…</div>
        ) : error ? (
          <div className="library-doclist-empty" role="alert">
            <div className="inline-flex items-center gap-1.5 text-[var(--color-danger)]">
              <Icon name="ph:warning-circle" width={13} aria-hidden />
              Couldn&rsquo;t load documents.
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">{error}</div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:arrow-clockwise" width={11} />
                Retry
              </button>
            ) : null}
          </div>
        ) : filtered.length === 0 ? (
          <div className="library-doclist-empty">
            <Icon name="ph:books" width={18} className="mx-auto mb-2 block text-[var(--text-muted)]" aria-hidden />
            <div className="text-[13px] font-medium text-[var(--text-primary)]">
              {searchQuery ? "No documents match your search." : "No documents yet."}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
              {searchQuery ? "Try a shorter query or clear the search." : "Documents your familiars collect or you import will appear here."}
            </p>
          </div>
        ) : (
          filtered.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={`library-doclist-item${doc.id === selectedId ? " library-doclist-item--active" : ""}`}
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
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
