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

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchInput } from "@/components/ui/search-input";
import { copyText } from "@/lib/clipboard";
import { Icon } from "@/lib/icon";
import { paperArxivUrl, paperDownloadUrl } from "@/lib/research-paper-view";
import {
  groupSavedLinksByUsage,
  linkCategoryMeta,
  LINK_CATEGORY_ORDER,
  MAX_LINKS_PER_SAVE,
  normalizeLinkUrl,
  summarizeLinkIntake,
  type LinkCategory,
  type SavedLink,
} from "@/lib/link-organizer";
import type { ResearchMission } from "@/lib/research-missions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { ResearchTabProps } from "./researcher-surface";
import { ResearchXSources } from "./research-x-sources";
import { useResearchLinks } from "./use-research-links";

// pdf.js is browser-only (it dies on `DOMMatrix` under Node), so the paper
// viewer never renders on the server. The dynamic boundary also keeps the PDF
// machinery out of the bundle for anyone who never opens a paper.
const ResearchPaperViewer = dynamic(() => import("@/components/research-paper-viewer"), {
  ssr: false,
});

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
  // The paper viewer is opt-in: mounting it pulls the pdfjs-dist chunk and
  // starts a multi-megabyte document fetch, and the overlay's cited-by content
  // sits below a 60vh PDF stage. Someone who opened the resource to read that
  // should not pay for the reader they never asked for.
  const [reading, setReading] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const selectedMission = research.selected;
  const act = research.act;
  const intake = useMemo(() => summarizeLinkIntake(draft, links), [draft, links]);

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

  const groups = useMemo(
    () => groupSavedLinksByUsage(visibleLinks, citedByIndex, selectedMission?.id),
    [visibleLinks, citedByIndex, selectedMission?.id],
  );
  const intakeMessage = !draft.trim()
    ? "Paste links to preview the batch."
    : intake.detectedCount === 0
      ? "No links found. Paste full http:// or https:// URLs."
      : intake.overLimit
        ? `${intake.detectedCount} links detected · maximum ${MAX_LINKS_PER_SAVE}.`
        : intake.ready.length === 0
          ? `All ${intake.duplicates.length} ${
              intake.duplicates.length === 1 ? "resource is" : "resources are"
            } already saved.`
          : `${intake.ready.length} ${
              intake.ready.length === 1 ? "resource" : "resources"
            } ready${
              intake.duplicates.length > 0
                ? ` · ${intake.duplicates.length} already saved`
                : ""
            }.`;

  // ── Add to run: same mechanism as the evidence ledger's manual attach —
  // an `attach-source` action landing the link as a candidate source on the
  // currently selected mission.
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

  // ── Batch intake: the client preview is advisory; this result line reports
  // exactly what the authoritative server accepted or skipped.
  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !intake.canSubmit) return;
    const submittedDraft = draft;
    setSaving(true);
    const result = await save(submittedDraft);
    setSaving(false);

    let message: string;
    if (!result.ok) {
      message = result.error ?? "Couldn’t save resources.";
    } else if (result.added === 0 && result.duplicates > 0) {
      message = `All ${result.duplicates} ${
        result.duplicates === 1 ? "resource was" : "resources were"
      } already saved.`;
    } else if (result.added === 0) {
      message = "No links found. Paste full http:// or https:// URLs.";
    } else {
      message = `Saved ${result.added} ${
        result.added === 1 ? "resource" : "resources"
      }${
        result.duplicates > 0
          ? ` · skipped ${result.duplicates} ${
              result.duplicates === 1 ? "duplicate" : "duplicates"
            }`
          : ""
      }.`;
      if (result.added > 0) {
        setDraft((current) => current === submittedDraft ? "" : current);
      }
    }
    setSaveStatus(message);
    announce(message, result.ok ? "polite" : "assertive");
  };

  const onIntakeKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const submitsBatch = event.key === "Enter" && (event.metaKey || event.ctrlKey);
    if (!submitsBatch) return;
    event.preventDefault();
    if (intake.canSubmit && !saving) event.currentTarget.form?.requestSubmit();
  };

  // ── Detail overlay: focus-trapped dialog over the open link.
  const openLink = openId ? links.find((link) => link.id === openId) ?? null : null;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeOverlay = useCallback(() => setOpenId(null), []);
  useFocusTrap(Boolean(openLink), dialogRef, { onEscape: closeOverlay });

  // A fresh overlay never inherits the previous one's confirm/copied/reading
  // state — closing the overlay or opening a different resource both land
  // here, so paper B never opens with paper A's viewer already expanded.
  useEffect(() => {
    setConfirmingRemove(false);
    setCopied(false);
    setReading(false);
  }, [openId]);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copyUrl = async (url: string) => {
    // copyText (lib/clipboard) falls back to execCommand where
    // navigator.clipboard doesn't exist — the packaged Tauri webview and
    // other non-secure contexts — and reports whether the copy landed, so
    // the ✓ feedback only shows on real success.
    const ok = await copyText(url);
    if (!ok) {
      announce("Couldn’t copy the link.", "assertive");
      return;
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1200);
    announce("Link copied.");
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
  const openPaperId = openLink?.paper?.arxivId ?? null;

  return (
    <section className="research-res" aria-label="Research resources">
      <header className="research-res__head">
        <h2>Resources</h2>
        <span className="research-res__count">
          {links.length} saved · from pastes, /save, and run citations
        </span>
      </header>

      {/* cave-lsj8u: src/app/api/x/ never landed, so this section's every
          fetch (/api/x/sources, /posts/search, /posts/lookup) 404s and it
          renders a permanent ErrorState. Gate it on the capability flag the
          familiars API already returns — off by default, so the surface stays
          hidden until the routes exist. Delete this condition when they land;
          the component itself needs no change. */}
      {context.activeFamiliar?.xResearchEnabled ? (
        <ResearchXSources
          familiar={context.activeFamiliar}
          selectedMissionId={selectedMission?.id ?? null}
          onMissionAttached={research.applyMission}
        />
      ) : null}

      <form className="research-res__intake" onSubmit={onSave}>
        <div className="research-res__intake-head">
          <div>
            <label htmlFor="research-resource-intake">Add resources</label>
            <p id="research-resource-intake-help">
              Paste up to {MAX_LINKS_PER_SAVE} links, separated by commas or line breaks.
            </p>
          </div>
          <kbd>⌘/Ctrl + Enter</kbd>
        </div>
        <textarea
          id="research-resource-intake"
          className="research-res__paste focus-ring"
          rows={3}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaveStatus(null);
          }}
          onKeyDown={onIntakeKeyDown}
          placeholder="e.g., https://docs.example.com, https://arxiv.org/…"
          aria-describedby="research-resource-intake-help research-resource-intake-preview"
          aria-keyshortcuts="Meta+Enter Control+Enter"
        />
        <div className="research-res__intake-footer">
          <div
            id="research-resource-intake-preview"
            className="research-res__intake-preview"
            role="status"
          >
            <span>{intakeMessage}</span>
            {intake.detectedCount > 0 ? (
              <span className="research-res__intake-types">
                {LINK_CATEGORY_ORDER.filter((category) => intake.categoryCounts[category]).map(
                  (category) => (
                    <span key={category}>
                      {linkCategoryMeta(category).label} {intake.categoryCounts[category]}
                    </span>
                  ),
                )}
              </span>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={saving}
            disabled={saving || !intake.canSubmit}
          >
            Save resources
          </Button>
        </div>
      </form>
      {saveStatus ? (
        <p className="research-res__save-status" role="status">{saveStatus}</p>
      ) : null}

      <div className="research-res__toolbar">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery("")}
          placeholder="Search resources…"
          aria-label="Search resources"
          containerClassName="research-res__search"
        />
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
              {linkCategoryMeta(category).label} <span>{categoryCounts.get(category)}</span>
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
        <div className="research-res__empty research-res__empty--filtered">
          <span>Nothing matches “{trimmedQuery}” — try a different term or clear the filter.</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.id}
            className="research-res__group"
            aria-label={`${group.label} resources`}
          >
            <header className="research-res__group-head">
              <i className="research-res__group-mark" data-group={group.id} aria-hidden />
              <h3>{group.label}</h3>
              <span className="research-res__group-count">{group.links.length}</span>
              <span className="research-res__group-desc">{group.description}</span>
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
                        <Icon name={linkCategoryMeta(link.category).icon} width={11} height={11} aria-hidden />
                        {linkCategoryMeta(link.category).label}
                      </span>
                      <span className="research-res-card__saved">
                        saved <RelativeTime iso={link.addedAt} fallback="just now" />
                      </span>
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
                    <div className="research-res-card__footer">
                      <span className="research-res-card__meta">
                        {cited.length > 0
                          ? `Cited by ${cited.length} ${cited.length === 1 ? "run" : "runs"}`
                          : "Not cited yet"}
                      </span>
                      <div className="research-res-card__buttons">
                        <Button
                          size="xs"
                          variant="ghost"
                          trailingIcon="ph:arrow-square-out"
                          onClick={() => context.openUrl(link.url)}
                        >
                          Open link
                        </Button>
                        {inRun ? (
                          <span className="research-res-card__state">
                            <Icon name="ph:check" width={11} height={11} aria-hidden />
                            In this run
                          </span>
                        ) : selectedMission ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            leadingIcon="ph:plus"
                            disabled={attachBusy}
                            title={addHint(link)}
                            onClick={() => void attachToRun(link)}
                          >
                            Add to run
                          </Button>
                        ) : (
                          <span className="research-res-card__hint">Select a run to add</span>
                        )}
                      </div>
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
                <Icon name={linkCategoryMeta(openLink.category).icon} width={18} height={18} />
              </span>
              <div className="research-res-overlay__heading">
                <div className="research-res-overlay__meta">
                  <span className="research-res-card__chip">
                    {linkCategoryMeta(openLink.category).label}
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
            </div>

            <div className="research-res-overlay__body">
              {/* Papers ingested with arXiv metadata read in place. A link
                  saved before the feature — or one whose metadata fetch
                  degraded — carries no arxivId and keeps exactly the contents
                  it has always had. */}
              {openLink.paper?.arxivId ? (
                reading ? (
                  <ResearchPaperViewer
                    arxivId={openLink.paper.arxivId}
                    authors={openLink.paper.authors}
                    abstract={openLink.paper.abstract}
                    publishedAt={openLink.paper.publishedAt}
                  />
                ) : (
                  <div className="research-res-overlay__read">
                    <div className="research-res-overlay__read-copy">
                      <strong>Read this paper here</strong>
                      <span>
                        Opens the full PDF inline — selectable and searchable, page by page.
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon="ph:book-open"
                      onClick={() => setReading(true)}
                    >
                      Read
                    </Button>
                  </div>
                )
              ) : null}

              {/* Stats strip: only fields the store really holds or facts we
                  can derive — none of the design's invented metrics. */}
              <div className="research-res-overlay__stats">
                <div>
                  <strong>{linkCategoryMeta(openLink.category).label}</strong>
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
              <div className="research-res-overlay__primary-actions">
                {!selectedMission ? (
                  <span className="research-res-overlay__hint">
                    Select a run to add this resource.
                  </span>
                ) : null}
                {/* An ingested paper's saved URL IS its Hugging Face page —
                    `collectIngestUrls` canonicalises every reference to
                    huggingface.co/papers/<id> — so "Open link" already covers
                    the HF half of the spec's link-out set. These two add the
                    other half: the arXiv record, and the PDF itself for
                    saving. Both point at arxiv.org rather than the loopback
                    proxy, which means nothing once the URL leaves the app. */}
                {openPaperId ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      trailingIcon="ph:arrow-square-out"
                      onClick={() => context.openUrl(paperArxivUrl(openPaperId))}
                    >
                      arXiv
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon="ph:download-simple"
                      onClick={() => context.openUrl(paperDownloadUrl(openPaperId))}
                    >
                      Download PDF
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  trailingIcon="ph:arrow-square-out"
                  onClick={() => context.openUrl(openLink.url)}
                >
                  Open link
                </Button>
                {attachedToSelected(openLink) ? (
                  <span className="research-res-card__state">
                    <Icon name="ph:check" width={11} height={11} aria-hidden />
                    In this run
                  </span>
                ) : selectedMission ? (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon="ph:plus"
                    disabled={attachBusy}
                    title={addHint(openLink)}
                    onClick={() => void attachToRun(openLink)}
                  >
                    Add to run
                  </Button>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
