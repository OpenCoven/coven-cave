"use client";

/**
 * Research desk — Links shelf (cave-avrt).
 *
 * A durable drop-box for source links: paste one URL or a whole block of
 * text, and every http(s) link in it is extracted, categorized (GitHub /
 * Docs / Papers / Articles / Video / Discussions / Other), titled from its
 * URL, and saved. The chat `/save` (alias `/link`) command feeds the same
 * store, so the shelf is the single place saved links land.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { extractLinks } from "@/lib/link-extractor";
import { groupSavedLinks, type SavedLink } from "@/lib/link-organizer";

type Props = {
  onOpenUrl(url: string): void;
};

export function ResearchLinkShelf({ onOpenUrl }: Props) {
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/research/links", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; links?: SavedLink[] };
      if (res.ok && data.ok && Array.isArray(data.links)) {
        setLinks(data.links);
        setError(null);
      } else {
        setError("Couldn't load saved links.");
      }
    } catch {
      setError("Couldn't load saved links. Is the desktop reachable?");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const draftLinkCount = extractLinks(draft).length;

  async function saveDraft() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/research/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "desk" }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        added?: SavedLink[];
        duplicates?: string[];
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      const added = data.added?.length ?? 0;
      const dupes = data.duplicates?.length ?? 0;
      setDraft("");
      setNote(
        added > 0
          ? `Saved ${added} link${added === 1 ? "" : "s"}${dupes > 0 ? ` — ${dupes} already on the shelf` : ""}.`
          : dupes > 0
            ? "Already on the shelf."
            : "No links found in that text.",
      );
      await load();
    } catch {
      setError("Couldn't save. Is the desktop reachable?");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch("/api/research/links", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setLinks((current) => current.filter((link) => link.id !== id));
      }
    } catch {
      /* the next load re-syncs */
    }
  }

  const groups = groupSavedLinks(links);

  return (
    <section className="research-links" aria-label="Saved links">
      <header className="research-links__header">
        <h3 className="research-links__title">
          <Icon name="ph:link" width={14} height={14} aria-hidden /> Links
        </h3>
        <span className="research-links__hint">
          Paste one or many — auto-organized. `/save` in chat lands here too.
        </span>
      </header>

      <div className="research-links__composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void saveDraft();
            }
          }}
          rows={2}
          placeholder="https://… (or paste any text — every link in it is saved)"
          aria-label="Links to save"
          className="research-links__input focus-ring-inset"
          disabled={busy}
        />
        <Button
          size="xs"
          variant="primary"
          onClick={() => void saveDraft()}
          disabled={busy || draftLinkCount === 0}
        >
          {busy ? "Saving…" : draftLinkCount > 1 ? `Save ${draftLinkCount} links` : "Save"}
        </Button>
      </div>

      {error ? (
        <p className="research-links__note" role="alert">{error}</p>
      ) : note ? (
        <p className="research-links__note" role="status">{note}</p>
      ) : null}

      {groups.length > 0 ? (
        <div className="research-links__groups">
          {groups.map((group) => (
            <div key={group.category} className="research-links__group">
              <h4 className="research-links__group-title">
                <Icon name={group.icon} width={13} height={13} aria-hidden />
                {group.label}
                <span className="research-links__count">{group.links.length}</span>
              </h4>
              <ul className="research-links__list">
                {group.links.map((link) => (
                  <li key={link.id} className="research-links__row">
                    <button
                      type="button"
                      className="research-links__open focus-ring-inset"
                      onClick={() => onOpenUrl(link.url)}
                      title={link.url}
                    >
                      <span className="research-links__link-title">{link.title}</span>
                      <span className="research-links__url">{link.url}</span>
                    </button>
                    <span className="research-links__meta">
                      <RelativeTime iso={link.addedAt} />
                    </span>
                    <button
                      type="button"
                      className="research-links__remove focus-ring touch-always-visible"
                      onClick={() => void remove(link.id)}
                      aria-label={`Remove ${link.title}`}
                    >
                      <Icon name="ph:x" width={12} height={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="research-links__empty">
          Nothing saved yet. Paste links above, or type <code>/save &lt;url&gt;</code> in any chat.
        </p>
      )}
    </section>
  );
}
