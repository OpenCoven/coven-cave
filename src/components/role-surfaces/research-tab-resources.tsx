"use client";

/**
 * Resources tab — the saved-links browser (cave-dl74, Phase B5).
 *
 * Everything on screen is derived from real data: the `/api/research/links`
 * store (via useResearchLinks) and the missions' source ledgers. Saved links
 * carry only url/title/category/addedAt/source — so cards and the detail
 * overlay render exactly those fields plus derived facts (domain, cited-by
 * runs). None of the design's invented popularity metrics are shown.
 *
 * "Add to run" attaches the link to the currently selected mission as a
 * candidate source through the exact mechanism the evidence ledger uses
 * (`attach-source` action) so triage semantics stay identical.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { Icon } from "@/lib/icon";
import {
  LINK_CATEGORY_META,
  LINK_CATEGORY_ORDER,
  groupSavedLinks,
  normalizeLinkUrl,
  type LinkCategory,
  type SavedLink,
} from "@/lib/link-organizer";
import type { ResearchMission } from "@/lib/research-missions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { ResearchTabProps } from "./researcher-surface";
import { useResearchLinks } from "./use-research-links";

const VIEW_STORAGE_KEY = "cave:research:res-view";

type ResourceView = "grid" | "rows";

/** Stored layout preference; SSR-guarded so the module stays import-safe. */
function readStoredView(): ResourceView {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "rows" ? "rows" : "grid";
  } catch {
    return "grid";
  }
}

/** Group blurbs per the design, adapted to the repo's real link categories. */
const CATEGORY_DESCRIPTIONS: Record<LinkCategory, string> = {
  github: "repositories & issues",
  docs: "official documentation",
  paper: "academic papers",
  article: "posts & essays",
  video: "talks & recordings",
  social: "community threads",
  other: "everything else",
};

function linkDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

export function ResearchTabResources({ research, context, onNavigate }: ResearchTabProps) {
  const { links, loading, error, load, save, remove } = useResearchLinks();
  const { announce } = useAnnouncer();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LinkCategory | "all">("all");
  const [view, setView] = useState<ResourceView>(readStoredView);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);

  const selectView = useCallback((next: ResourceView) => {
    setView(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private mode / quota — the choice still holds for the session.
    }
  }, []);

  // ── Cited-by index: normalized link URL → missions whose source ledger
  // holds that URL. This is the honest cross-reference the design's
  // "cited by runs" line is built from.
  const citedByIndex = useMemo(() => {
    const index = new Map<string, ResearchMission[]>();
    for (const mission of research.missions) {
      const urls = new Set<string>();
      for (const source of mission.sources) {
        if (source.url) urls.add(normalizeLinkUrl(source.url));
      }
      for (const url of urls) {
        const bucket = index.get(url) ?? [];
        bucket.push(mission);
        index.set(url, bucket);
      }
    }
    return index;
  }, [research.missions]);

  const citingMissions = useCallback(
    (link: SavedLink) => citedByIndex.get(normalizeLinkUrl(link.url)) ?? [],
    [citedByIndex],
  );

  const uncitedCount = useMemo(
    () => links.filter((link) => citingMissions(link).length === 0).length,
    [links, citingMissions],
  );

  // Filter chips carry real per-category counts (query-independent).
  const categoryCounts = useMemo(() => {
    const counts = new Map<LinkCategory, number>();
    for (const link of links) counts.set(link.category, (counts.get(link.category) ?? 0) + 1);
    return counts;
  }, [links]);

  // A filter whose category emptied out (last save removed) falls back to All.
  const activeFilter: LinkCategory | "all" =
    filter !== "all" && !categoryCounts.has(filter) ? "all" : filter;

  const trimmedQuery = query.trim();
  const visibleLinks = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return links.filter((link) =>
      (activeFilter === "all" || link.category === activeFilter) &&
      (!q || `${link.title} ${link.url}`.toLowerCase().includes(q)));
  }, [links, trimmedQuery, activeFilter]);

  const groups = useMemo(() => groupSavedLinks(visibleLinks), [visibleLinks]);

  // ── Add to run: same mechanism as the evidence ledger's manual attach —
  // an `attach-source` action landing the link as a candidate source on the
  // currently selected mission.
  const selectedMission = research.selected;
  const act = research.act;

  const attachedToSelected = useCallback((link: SavedLink) => {
    if (!selectedMission) return false;
    const key = normalizeLinkUrl(link.url);
    return selectedMission.sources.some(
      (source) => source.url && normalizeLinkUrl(source.url) === key,
    );
  }, [selectedMission]);

  const attachToRun = useCallback(async (link: SavedLink) => {
    if (!selectedMission) return;
    setAttachBusy(true);
    try {
      const result = await act(selectedMission.id, {
        action: "attach-source",
        source: {
          id: `save-${Date.now().toString(36)}`,
          title: link.title,
          url: link.url,
          sourceType: "web",
          status: "candidate",
        },
      });
      if (result.ok) {
        announce(`Added to “${selectedMission.title}” as a candidate source.`);
      } else {
        announce(result.error ?? "Couldn’t add the source to the run.", "assertive");
      }
    } finally {
      setAttachBusy(false);
    }
  }, [selectedMission, act, announce]);

  const addHint = (link: SavedLink): string =>
    !selectedMission
      ? "Select a run on the Desk first"
      : attachedToSelected(link)
        ? "Already a source on the selected run"
        : `Add to “${selectedMission.title}” as a candidate source`;

  // ── Save row: the dashed paste target is a real input; the result line
  // reports exactly what the server extracted (added / duplicates / nothing).
  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !draft.trim()) return;
    setSaving(true);
    const result = await save(draft);
    setSaving(false);
    let message: string;
    if (!result.ok) {
      message = result.error ?? "Couldn’t save.";
    } else if (result.added === 0 && result.duplicates === 0) {
      message = "No links found in that text.";
    } else {
      const parts: string[] = [];
      if (result.added > 0) parts.push(`Saved ${result.added} link${result.added === 1 ? "" : "s"}`);
      if (result.duplicates > 0) {
        parts.push(`skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}`);
      }
      message = `${parts.join(" · ")}.`;
      setDraft("");
    }
    setSaveStatus(message);
    announce(message, result.ok ? "polite" : "assertive");
  };

  // ── Detail overlay: focus-trapped dialog over the open link.
  const openLink = openId ? links.find((link) => link.id === openId) ?? null : null;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeOverlay = useCallback(() => setOpenId(null), []);
  useFocusTrap(Boolean(openLink), dialogRef, { onEscape: closeOverlay });

  // A fresh overlay never inherits the previous one's confirm/copied state.
  useEffect(() => {
    setConfirmingRemove(false);
    setCopied(false);
  }, [openId]);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
      announce("Link copied.");
    } catch {
      announce("Couldn’t copy the link.", "assertive");
    }
  };

  const removeOpenLink = async () => {
    if (!openLink) return;
    const ok = await remove(openLink.id);
    setConfirmingRemove(false);
    if (ok) {
      announce("Removed from saves.");
      setOpenId(null);
    } else {
      announce("Couldn’t remove the save — try again.", "assertive");
    }
  };

  const openCited = openLink ? citingMissions(openLink) : [];

  return (
    <section className="research-res" aria-label="Research resources">
      <header className="research-res__head">
        <h2>Resources</h2>
        <span className="research-res__count">
          {links.length} saved · from pastes, /save, and run citations
        </span>
      </header>

      <form className="research-res__saverow" onSubmit={onSave}>
        <input
          className="research-res__search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search resources…"
          aria-label="Search resources"
        />
        <input
          className="research-res__paste"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Paste a link or a block of text — every URL is extracted, titled, and filed automatically"
          aria-label="Paste links to save"
        />
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={saving || !draft.trim()}>
          Save
        </Button>
      </form>
      {saveStatus ? (
        <p className="research-res__save-status" role="status">{saveStatus}</p>
      ) : null}

      <div className="research-res__toolbar">
        <div className="research-res__chips" role="group" aria-label="Filter resources by category">
          <button
            type="button"
            className="research-res__chip"
            aria-pressed={activeFilter === "all"}
            onClick={() => setFilter("all")}
          >
            All <span>{links.length}</span>
          </button>
          {LINK_CATEGORY_ORDER.filter((category) => categoryCounts.has(category)).map((category) => (
            <button
              key={category}
              type="button"
              className="research-res__chip"
              aria-pressed={activeFilter === category}
              onClick={() => setFilter(category)}
            >
              {LINK_CATEGORY_META[category].label} <span>{categoryCounts.get(category)}</span>
            </button>
          ))}
        </div>
        <div className="research-res__seg" role="group" aria-label="Resource layout">
          <button type="button" aria-pressed={view === "grid"} onClick={() => selectView("grid")}>
            <Icon name="ph:squares-four" width={12} height={12} aria-hidden />
            Grid
          </button>
          <button type="button" aria-pressed={view === "rows"} onClick={() => selectView("rows")}>
            <Icon name="ph:rows" width={12} height={12} aria-hidden />
            Rows
          </button>
        </div>
      </div>

      {loading ? (
        <p className="research-res__empty">Loading saved links…</p>
      ) : error ? (
        <p className="research-res__error" role="alert">
          {error}{" "}
          <Button size="xs" variant="ghost" onClick={() => void load()}>Retry</Button>
        </p>
      ) : links.length === 0 ? (
        <p className="research-res__empty">
          Nothing saved yet — paste a link above, or use /save in chat.
        </p>
      ) : groups.length === 0 ? (
        <p className="research-res__empty">
          Nothing matches “{trimmedQuery}” — try a different term or clear the filter.
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            className="research-res__group"
            aria-label={`${group.label} resources`}
          >
            <header className="research-res__group-head">
              <i className="research-res__group-mark" data-category={group.category} aria-hidden />
              <h3>{group.label}</h3>
              <span className="research-res__group-count">{group.links.length}</span>
              <span className="research-res__group-desc">{CATEGORY_DESCRIPTIONS[group.category]}</span>
            </header>
            <div className="research-res__items" data-view={view}>
              {group.links.map((link) => {
                const cited = citingMissions(link);
                const inRun = attachedToSelected(link);
                return (
                  <article
                    key={link.id}
                    className="research-res-card"
                    data-view={view}
                    data-category={link.category}
                  >
                    <div className="research-res-card__head">
                      <span className="research-res-card__chip">
                        <Icon name={LINK_CATEGORY_META[link.category].icon} width={11} height={11} aria-hidden />
                        {LINK_CATEGORY_META[link.category].label}
                      </span>
                      {view === "grid" ? (
                        <span className="research-res-card__saved">
                          saved <RelativeTime iso={link.addedAt} fallback="just now" />
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={
                        "research-res-card__title" +
                        (link.category === "github" ? " research-res-card__title--mono" : "")
                      }
                      onClick={() => setOpenId(link.id)}
                    >
                      {link.title}
                      <span className="sr-only"> — open details</span>
                    </button>
                    <span className="research-res-card__sub">{linkDomain(link.url)}</span>
                    <div className="research-res-card__actions">
                      <button
                        type="button"
                        className="research-res-card__add"
                        disabled={!selectedMission || attachBusy || inRun}
                        title={addHint(link)}
                        onClick={() => void attachToRun(link)}
                      >
                        <Icon name="ph:plus" width={11} height={11} aria-hidden />
                        {inRun ? "In run" : "Add to run"}
                        <span className="sr-only"> — {addHint(link)}</span>
                      </button>
                      <span className="research-res-card__meta">
                        {cited.length > 0 ? (
                          <span>cited by {cited.length} run{cited.length === 1 ? "" : "s"}</span>
                        ) : null}
                        {view === "rows" ? (
                          <span>saved <RelativeTime iso={link.addedAt} fallback="just now" /></span>
                        ) : null}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      {!loading && !error && links.length > 0 && uncitedCount > 0 ? (
        <div className="research-res__nudge">
          <span className="research-res__nudge-mark" aria-hidden>✦</span>
          <span className="research-res__nudge-text">
            {uncitedCount} of these resources {uncitedCount === 1 ? "is" : "are"} uncited by any
            run. Start a brief that folds them in?
          </span>
          <Button size="xs" variant="primary" onClick={() => onNavigate("prompt")}>
            Draft the brief
          </Button>
        </div>
      ) : null}

      {openLink ? (
        <div className="research-res-overlay" onClick={closeOverlay}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="research-res-overlay-title"
            className="research-res-overlay__dialog"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="research-res-overlay__head">
              <span className="research-res-overlay__glyph" aria-hidden>
                <Icon name={LINK_CATEGORY_META[openLink.category].icon} width={18} height={18} />
              </span>
              <div className="research-res-overlay__heading">
                <div className="research-res-overlay__meta">
                  <span className="research-res-card__chip">
                    {LINK_CATEGORY_META[openLink.category].label}
                  </span>
                  <span className="research-res-overlay__saved">
                    saved <RelativeTime iso={openLink.addedAt} fallback="just now" />
                  </span>
                </div>
                <h3
                  id="research-res-overlay-title"
                  className={openLink.category === "github" ? "research-res-overlay__title--mono" : undefined}
                >
                  {openLink.title}
                </h3>
                <span className="research-res-overlay__sub">{linkDomain(openLink.url)}</span>
              </div>
              <button
                type="button"
                className="research-res-overlay__close"
                onClick={closeOverlay}
                aria-label="Close resource details"
              >
                <Icon name="ph:x" width={13} height={13} aria-hidden />
              </button>
            </header>

            <div className="research-res-overlay__source">
              <Icon name="ph:link-simple" width={12} height={12} aria-hidden />
              <span className="research-res-overlay__url">{openLink.url}</span>
              <button
                type="button"
                className="research-res-overlay__source-btn"
                data-copied={copied || undefined}
                onClick={() => void copyUrl(openLink.url)}
              >
                <Icon name={copied ? "ph:check" : "ph:copy"} width={11} height={11} aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className="research-res-overlay__source-btn"
                onClick={() => context.openUrl(openLink.url)}
              >
                Open
                <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
              </button>
            </div>

            <div className="research-res-overlay__body">
              {/* Stats strip: only fields the store really holds or facts we
                  can derive — none of the design's invented metrics. */}
              <div className="research-res-overlay__stats">
                <div>
                  <strong>{LINK_CATEGORY_META[openLink.category].label}</strong>
                  <span>category</span>
                </div>
                <div>
                  <strong><RelativeTime iso={openLink.addedAt} fallback="just now" /></strong>
                  <span>saved</span>
                </div>
                <div>
                  <strong>{linkDomain(openLink.url)}</strong>
                  <span>domain</span>
                </div>
                <div>
                  <strong>{openCited.length} run{openCited.length === 1 ? "" : "s"}</strong>
                  <span>cited by</span>
                </div>
              </div>

              {openCited.length > 0 ? (
                <div className="research-res-overlay__runs">
                  <div className="research-res-overlay__runs-label">
                    <i aria-hidden />
                    <span>Cited by runs</span>
                  </div>
                  <div className="research-res-overlay__runs-chips">
                    {openCited.map((mission) => (
                      <button
                        key={mission.id}
                        type="button"
                        onClick={() => {
                          closeOverlay();
                          onNavigate("desk", { missionId: mission.id });
                        }}
                      >
                        {mission.title} <span aria-hidden>→</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="research-res-overlay__actions">
              <Button
                size="sm"
                variant="primary"
                leadingIcon="ph:plus"
                disabled={!selectedMission || attachBusy || attachedToSelected(openLink)}
                title={addHint(openLink)}
                onClick={() => void attachToRun(openLink)}
              >
                {attachedToSelected(openLink) ? "In run" : "Add to run"}
              </Button>
              {!selectedMission ? (
                <span className="research-res-overlay__hint">
                  Select a run on the Desk to attach sources.
                </span>
              ) : null}
              <div className="research-res-overlay__remove">
                {confirmingRemove ? (
                  <>
                    <span className="research-res-overlay__remove-warn">
                      Remove this save? It leaves Resources and quick saves.
                    </span>
                    <Button size="xs" variant="danger-ghost" onClick={() => void removeOpenLink()}>
                      Yes, remove
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirmingRemove(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => setConfirmingRemove(true)}>
                    Remove from saves
                  </Button>
                )}
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
