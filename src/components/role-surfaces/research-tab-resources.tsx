"use client";

/**
 * Resources tab — the saved-links browser (cave-dl74, Phase B5).
 *
 * Everything on screen is derived from real data: the `/api/research/links`
 * store (via useResearchLinks) and the missions' source ledgers. Saved-link
 * summaries carry url/title/category/addedAt/source and optional structured
 * paper or X Article metadata, never an Article body — so cards and the
 * detail overlay render real fields plus derived facts (domain, cited-by
 * runs). None of the design's invented popularity metrics are shown.
 *
 * "Add to run" attaches the link to the currently selected mission as a
 * candidate source through the exact mechanism the evidence ledger uses
 * (`attach-source` action) so triage semantics stay identical.
 */

import dynamic from "next/dynamic";
import "@/styles/research-paper-focus-reader.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ResearchXArticleReader } from "@/components/research-x-article-reader";
import { ResearchResourceBrowserModal } from "@/components/research-resource-browser-modal";
import { AuthedImage } from "@/components/ui/authed-image";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchInput } from "@/components/ui/search-input";
import { copyText } from "@/lib/clipboard";
import { caveResearchRemoteContent } from "@/lib/feature-flags";
import { Icon } from "@/lib/icon";
import { paperArxivUrl, paperDownloadUrl } from "@/lib/research-paper-view";
import { researchResourceSourceUrl } from "@/lib/research-resource-browser";
import {
  groupSavedLinksByUsage,
  linkCategoryMeta,
  LINK_CATEGORY_ORDER,
  MAX_LINKS_PER_SAVE,
  savedLinkDedupeKey,
  summarizeLinkIntake,
  type LinkCategory,
  type SavedLinkSummary,
} from "@/lib/link-organizer";
import type { ResearchMission } from "@/lib/research-missions";
import type { ResourceManifestV1 } from "@/lib/research-resource-contracts";
import { resourceForQueryHit } from "@/lib/research-resource-client";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  MAX_X_ARTICLES_PER_INGEST,
  parseXArticleCandidateUrl,
  type XArticleIngestFailure,
} from "@/lib/x-articles";
import type { ResearchTabProps } from "./researcher-surface";
import { ResearchGithubRepoViewer } from "./research-github-repo-viewer";
import { ResearchXSources } from "./research-x-sources";
import { useResearchLinks } from "./use-research-links";
import { useResearchResources } from "./use-research-resources";

// pdf.js is browser-only (it dies on `DOMMatrix` under Node), so the paper
// viewer never renders on the server. The dynamic boundary also keeps the PDF
// machinery out of the bundle for anyone who never opens a paper.
const ResearchPaperViewer = dynamic(() => import("@/components/research-paper-viewer"), {
  ssr: false,
});

const VIEW_STORAGE_KEY = "cave:research:res-view";

type ResourceView = "grid" | "rows";
type SaveFeedbackTone = "status" | "alert";

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

function linkSearchText(link: SavedLinkSummary): string {
  return [
    link.title,
    link.url,
    link.xArticle ? "X Article" : undefined,
    link.xArticle?.author.username,
    link.xArticle?.author.displayName,
    link.xArticle?.excerpt,
    link.xArticle?.publishedAt,
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function ingestStateLabel(resource: ResourceManifestV1): string {
  return resource.ingest.state.replaceAll("_", " ");
}

function localResourceCount(count: number): string {
  return `${count} local ${count === 1 ? "resource" : "resources"}`;
}

export function ResearchTabResources({ research, context, onNavigate }: ResearchTabProps) {
  const { links, loading, error, load, save, loadDetail, remove } = useResearchLinks();
  const local = useResearchResources();
  const { announce } = useAnnouncer();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LinkCategory | "all">("all");
  const [view, setView] = useState<ResourceView>(readStoredView);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveFailures, setSaveFailures] = useState<XArticleIngestFailure[]>([]);
  const [saveFeedbackTone, setSaveFeedbackTone] = useState<SaveFeedbackTone>("status");
  const [openId, setOpenId] = useState<string | null>(null);
  // The paper viewer is opt-in: mounting it pulls the pdfjs-dist chunk and
  // starts a multi-megabyte document fetch, and the overlay's cited-by content
  // sits below a 60vh PDF stage. Someone who opened the resource to read that
  // should not pay for the reader they never asked for.
  const [reading, setReading] = useState(false);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [articleDetail, setArticleDetail] = useState<Awaited<ReturnType<typeof loadDetail>>>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [resourceMutationBusy, setResourceMutationBusy] = useState<string | null>(null);
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);
  const [confirmingResourceId, setConfirmingResourceId] = useState<string | null>(null);
  // Browser-capable preview: { title, url } of the resource whose source URL the
  // user chose to open in the modal. The modal itself enforces the
  // consent.allowRemoteContent gate before ever loading the URL.
  const [browserPreview, setBrowserPreview] = useState<{ title: string; url: string | null } | null>(null);
  const resourceSearchRef = useRef<HTMLInputElement | null>(null);
  const articleRequestRef = useRef(0);
  const activeArticleIdRef = useRef<string | null>(null);
  const articleReaderRef = useRef<HTMLElement | null>(null);
  const pendingArticleFocusRef = useRef(false);
  const readerFocusControlRef = useRef<HTMLButtonElement>(null);
  const selectedMission = research.selected;
  const act = research.act;
  const intake = useMemo(() => summarizeLinkIntake(draft, links), [draft, links]);
  const resourceByLegacyId = useMemo(() => new Map(
    local.resources.flatMap((resource) => resource.legacySavedLink
      ? [[resource.legacySavedLink.id, resource] as const]
      : []),
  ), [local.resources]);
  const xArticleCandidates = useMemo(() => {
    const candidates = new Map<string, string>();
    for (const item of [...intake.ready, ...intake.duplicates]) {
      const candidate = parseXArticleCandidateUrl(item.url);
      if (candidate) candidates.set(candidate.sourcePostId, item.url);
    }
    return [...candidates.values()];
  }, [intake.duplicates, intake.ready]);
  const xArticleOverLimit = xArticleCandidates.length > MAX_X_ARTICLES_PER_INGEST;

  const selectView = useCallback((next: ResourceView) => {
    setView(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private mode / quota — the choice still holds for the session.
    }
  }, []);

  // ── Cited-by index: deduplicated link key → missions whose source ledger
  // holds that URL. savedLinkDedupeKey collapses X/twitter aliases so both
  // x.com and twitter.com links resolve to the same identity. This is the
  // honest cross-reference the design's "cited by runs" line is built from.
  const citedByIndex = useMemo(() => {
    const index = new Map<string, ResearchMission[]>();
    for (const mission of research.missions) {
      const urls = new Set<string>();
      for (const source of mission.sources) {
        if (source.url) urls.add(savedLinkDedupeKey(source.url));
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
    (link: Pick<SavedLinkSummary, "url">) => citedByIndex.get(savedLinkDedupeKey(link.url)) ?? [],
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
  const updateResourceQuery = useCallback((next: string) => {
    // Query text and evidence authority change as one UI transaction. Invalidate
    // the previous generation before React renders the new text; the debounce
    // must never leave evidence from query A labelled as query B.
    local.clearSearch();
    setQuery(next);
  }, [local.clearSearch]);
  const clearResourceQuery = useCallback(() => {
    updateResourceQuery("");
    announce("Cleared local evidence search.", "polite");
    queueMicrotask(() => resourceSearchRef.current?.focus());
  }, [announce, updateResourceQuery]);
  const retryResourceSearch = useCallback(async () => {
    resourceSearchRef.current?.focus();
    announce("Retrying local evidence search.", "polite");
    const ok = await local.search(trimmedQuery);
    announce(
      ok ? "Local evidence search refreshed." : "Local evidence search is still unavailable.",
      ok ? "polite" : "assertive",
    );
  }, [announce, local.search, trimmedQuery]);
  useEffect(() => {
    const timer = setTimeout(() => { void local.search(trimmedQuery); }, 250);
    return () => clearTimeout(timer);
  }, [local.search, trimmedQuery]);
  const visibleLinks = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return links.filter((link) =>
      (activeFilter === "all" || link.category === activeFilter) &&
      (!q || linkSearchText(link).includes(q)));
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
          : xArticleOverLimit
            ? `X Articles ${xArticleCandidates.length} of ${MAX_X_ARTICLES_PER_INGEST} · maximum reached.`
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
  const attachedToSelected = useCallback((link: SavedLinkSummary) => {
    if (!selectedMission) return false;
    const key = savedLinkDedupeKey(link.url);
    return selectedMission.sources.some(
      (source) => source.url && savedLinkDedupeKey(source.url) === key,
    );
  }, [selectedMission]);

  const attachToRun = useCallback(async (link: SavedLinkSummary) => {
    if (!selectedMission) return;
    setAttachBusy(true);
    try {
      const result = link.xArticle
        ? await act(selectedMission.id, {
            action: "attach-saved-link",
            savedLinkId: link.id,
            familiarId: selectedMission.familiarId,
          })
        : await act(selectedMission.id, {
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

  const addHint = (link: SavedLinkSummary): string =>
    !selectedMission
      ? "Select a run on the Desk first"
      : attachedToSelected(link)
        ? "Already a source on the selected run"
        : `Add to “${selectedMission.title}” as a candidate source`;

  // ── Batch intake: the client preview is advisory; this result line reports
  // exactly what the authoritative server accepted or skipped.
  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !intake.canSubmit || xArticleOverLimit) return;
    const submittedDraft = draft;
    const submittedActualXArticleIds = new Set(
      intake.ready.flatMap((url) => {
        const candidate = parseXArticleCandidateUrl(url.url);
        return candidate ? [candidate.sourcePostId] : [];
      }),
    );
    setSaveFailures([]);
    setSaveFeedbackTone("status");
    setSaving(true);
    const result = await save(submittedDraft);
    setSaving(false);
    setSaveFailures(result.failed);
    const failedArticleIds = new Set(
      result.failed.flatMap((failure) => {
        const candidate = parseXArticleCandidateUrl(failure.url);
        return candidate ? [candidate.sourcePostId] : [];
      }),
    );
    const totalSaveFailure = !result.ok || (
      result.added === 0
      && submittedActualXArticleIds.size > 0
      && [...submittedActualXArticleIds].every((sourcePostId) => failedArticleIds.has(sourcePostId))
    );
    setSaveFeedbackTone(totalSaveFailure ? "alert" : "status");

    let message: string;
    if (!result.ok) {
      message = result.error ?? "Couldn’t save resources.";
    } else if (result.added === 0 && result.failed.length > 0) {
      message = `Couldn’t save ${result.failed.length} ${
        result.failed.length === 1 ? "X Article" : "X Articles"
      }.`;
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
      }${result.failed.length > 0
        ? ` · ${result.failed.length} ${
          result.failed.length === 1 ? "X Article couldn't" : "X Articles couldn't"
        } be saved`
        : ""
      }.`;
      if (result.added > 0) {
        setDraft((current) => current === submittedDraft ? "" : current);
      }
    }
    if (!totalSaveFailure) announce(message, "polite");
    setSaveStatus(message);
  };

  const onIntakeKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const submitsBatch = event.key === "Enter" && (event.metaKey || event.ctrlKey);
    if (!submitsBatch) return;
    event.preventDefault();
    if (intake.canSubmit && !saving) event.currentTarget.form?.requestSubmit();
  };

  // ── Detail overlay: focus-trapped dialog over the open link.
  const openLink = openId ? links.find((link) => link.id === openId) ?? null : null;
  const openDurableResource = openLink ? resourceByLegacyId.get(openLink.id) : undefined;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeOverlay = useCallback(() => {
    articleRequestRef.current += 1;
    setOpenId(null);
  }, []);
  const handleOverlayEscape = useCallback(() => {
    if (readerExpanded) {
      setReaderExpanded(false);
      return;
    }
    closeOverlay();
  }, [closeOverlay, readerExpanded]);
  useFocusTrap(Boolean(openLink), dialogRef, { onEscape: handleOverlayEscape });

  useEffect(() => {
    if (reading && readerExpanded) readerFocusControlRef.current?.focus();
  }, [reading, readerExpanded]);

  // A fresh overlay never inherits the previous one's confirm/copied/reading
  // state — closing the overlay or opening a different resource both land
  // here, so paper B never opens with paper A's viewer already expanded.
  useEffect(() => {
    articleRequestRef.current += 1;
    activeArticleIdRef.current = openId;
    pendingArticleFocusRef.current = false;
    setConfirmingRemove(false);
    setCopied(false);
    setReading(false);
    setReaderExpanded(false);
    setArticleDetail(null);
    setArticleLoading(false);
    setArticleError(null);
  }, [openId]);

  useLayoutEffect(() => {
    if (!articleDetail?.xArticle || !pendingArticleFocusRef.current) return;
    const reader = articleReaderRef.current;
    if (!reader) return;
    pendingArticleFocusRef.current = false;
    reader.focus();
  }, [articleDetail]);

  const readArticle = useCallback(async () => {
    if (!openLink?.xArticle) return;
    const requestedId = openLink.id;
    const request = ++articleRequestRef.current;
    pendingArticleFocusRef.current = false;
    setArticleDetail(null);
    setArticleError(null);
    setArticleLoading(true);
    const detail = await loadDetail(requestedId);
    if (articleRequestRef.current !== request || activeArticleIdRef.current !== requestedId) return;
    setArticleLoading(false);
    if (!detail || detail.id !== requestedId || !detail.xArticle) {
      pendingArticleFocusRef.current = false;
      setArticleError("Couldn’t load the full article. Try again.");
      return;
    }
    pendingArticleFocusRef.current = true;
    setArticleDetail(detail);
  }, [loadDetail, openLink]);

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
    const resource = openDurableResource;
    setResourceMutationBusy(resource?.id ?? openLink.id);
    let ok = false;
    try {
      ok = resource ? await local.remove(resource.id) : await remove(openLink.id);
      if (ok && resource) await load();
    } finally {
      setResourceMutationBusy(null);
    }
    setConfirmingRemove(false);
    if (ok) {
      announce(resource
        ? `Deleted “${resource.title}” and its durable local evidence.`
        : "Removed from saves.");
      setOpenId(null);
    } else {
      announce("Couldn’t remove the save — try again.", "assertive");
    }
  };

  const retryResource = async (resource: ResourceManifestV1) => {
    setResourceMutationBusy(resource.id);
    let ok = false;
    try {
      ok = await local.retry(resource.id);
    } finally {
      setResourceMutationBusy(null);
    }
    announce(ok ? `Retry queued for “${resource.title}”.` : "Couldn’t retry ingestion.", ok ? "polite" : "assertive");
  };

  const deleteResource = async (resource: ResourceManifestV1) => {
    setResourceMutationBusy(resource.id);
    let ok = false;
    try {
      ok = await local.remove(resource.id);
      if (ok && resource.legacySavedLink) await load();
    } finally {
      setResourceMutationBusy(null);
    }
    if (ok) {
      setExpandedResourceId((current) => current === resource.id ? null : current);
      setConfirmingResourceId(null);
      announce(`Deleted “${resource.title}” and its durable local snapshots and evidence.`);
    } else {
      announce("Couldn’t delete the local resource — try again.", "assertive");
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

      {/* cave-vy5vp: browse a GitHub repository's files and README. The fetch
          is opt-in (no network until "Load repository"), which is the remote-
          content consent surface for the Research Desk. */}
      <ResearchGithubRepoViewer openUrl={context.openUrl} />

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
            setSaveFailures([]);
            setSaveFeedbackTone("status");
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
                {xArticleCandidates.length > 0 ? (
                  <span>
                    X Articles {xArticleCandidates.length} of {MAX_X_ARTICLES_PER_INGEST}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={saving}
            disabled={saving || !intake.canSubmit || xArticleOverLimit}
          >
            Save resources
          </Button>
        </div>
      </form>
      {saveStatus ? (
        <p
          className="research-res__save-status"
          role={saveFeedbackTone === "status" ? "status" : saveFailures.length === 0 ? "alert" : undefined}
        >
          {saveStatus}
        </p>
      ) : null}
      {saveFailures.length > 0 ? (
        <ul className="research-res__save-failures" role={saveFeedbackTone === "alert" ? "alert" : undefined}>
          {saveFailures.map((failure) => (
            <li key={`${failure.url}-${failure.code}`}>
              {failure.url}: {failure.message}{failure.retryable ? " Try again." : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="research-res__toolbar">
        <SearchInput
          ref={resourceSearchRef}
          value={query}
          onValueChange={updateResourceQuery}
          onClear={clearResourceQuery}
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

      {local.available && trimmedQuery.length >= 2 ? (
        <section className="research-res__evidence" aria-label="Local evidence results" aria-busy={local.searching}>
          <header className="research-res__evidence-head">
            <div>
              <h3>Local evidence</h3>
              <p>Exact and full-text matches from verified local snapshots.</p>
            </div>
            <span>{local.searching
              ? "Searching…"
              : `${local.result?.hits.length ?? 0} ${(local.result?.hits.length ?? 0) === 1 ? "match" : "matches"}`}</span>
          </header>
          {local.searchError ? (
            <div className="research-res__evidence-error" role="alert">
              <span>{local.searchError}</span>
              <div>
                <Button size="xs" variant="ghost" onClick={() => void retryResourceSearch()}>
                  Retry search
                </Button>
                <Button size="xs" variant="ghost" onClick={clearResourceQuery}>
                  Clear search
                </Button>
              </div>
            </div>
          ) : !local.searching && local.result?.hits.length === 0 ? (
            <p className="research-res__evidence-state">No ingested passages match this search.</p>
          ) : (
            <div className="research-res__evidence-list">
              {local.result?.hits.map((hit) => {
                const resource = resourceForQueryHit(local.resources, hit);
                const legacyId = resource?.legacySavedLink?.id;
                return (
                  <article className="research-res-evidence" key={`${hit.resourceId}:${hit.snapshotId}`}>
                    <div className="research-res-evidence__identity">
                      <strong>{resource?.title ?? "Local resource"}</strong>
                      <span>{resource
                        ? `${resource.kind.replaceAll("-", " ")} · revision ${hit.resourceRevision}`
                        : `revision ${hit.resourceRevision} · catalog metadata changed`}</span>
                    </div>
                    <p>{hit.excerpt}</p>
                    <footer>
                      <span>
                        {hit.retrieval.exact ? "Exact" : null}
                        {hit.retrieval.exact && hit.retrieval.lexical.matched ? " + " : null}
                        {hit.retrieval.lexical.matched ? "Full text" : null}
                        {hit.retrieval.semantic.state === "unavailable" ? " · Semantic unavailable" : null}
                      </span>
                      {legacyId ? (
                        <Button size="xs" variant="ghost" onClick={() => setOpenId(legacyId)}>
                          View resource
                        </Button>
                      ) : resource?.sourceUri ? (
                        <Button size="xs" variant="ghost" onClick={() => context.openUrl(resource.sourceUri!)}>
                          Open source
                        </Button>
                      ) : null}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {local.error ? (
        <div className="research-res__catalog-error" role="alert">
          <span>{local.error}</span>
          <Button size="xs" variant="ghost" onClick={() => void local.load()}>Retry</Button>
        </div>
      ) : null}

      {local.available ? (
        <section className="research-res__catalog" aria-labelledby="research-local-catalog-title">
          <header className="research-res__catalog-head">
            <div>
              <h3 id="research-local-catalog-title">Local catalog</h3>
              <p>Ingest status and controls for every durable local resource.</p>
            </div>
            <span>{local.loading ? "Refreshing…" : localResourceCount(local.resources.length)}</span>
          </header>
          {local.resources.length === 0 ? (
            <p className="research-res__catalog-empty">No local resources yet.</p>
          ) : (
            <div className="research-res__catalog-list">
              {local.resources.map((resource, index) => {
                const detailId = `research-local-resource-${index}`;
                const expanded = expandedResourceId === resource.id;
                const confirmingDelete = confirmingResourceId === resource.id;
                const retryable = resource.ingest.state === "failed" && resource.ingest.retryable !== false;
                const previewUrl = researchResourceSourceUrl(resource);
                return (
                  <article className="research-res-catalog-row" key={`${resource.id}:${resource.revision}`}>
                    <div className="research-res-catalog-row__summary">
                      <div className="research-res-catalog-row__identity">
                        <strong>{resource.title}</strong>
                        <span>{resource.kind.replaceAll("-", " ")} · revision {resource.revision}</span>
                      </div>
                      <span className="research-res-catalog-row__state" data-state={resource.ingest.state}>
                        {ingestStateLabel(resource)}
                      </span>
                      <div className="research-res-catalog-row__actions">
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={() => setExpandedResourceId(expanded ? null : resource.id)}
                        >
                          {expanded ? "Hide details" : "Details"}
                        </Button>
                        {retryable ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            loading={resourceMutationBusy === resource.id}
                            onClick={() => void retryResource(resource)}
                          >
                            Retry
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="danger-ghost"
                          disabled={resourceMutationBusy === resource.id}
                          onClick={() => setConfirmingResourceId(resource.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div id={detailId} className="research-res-catalog-row__details">
                        <dl>
                          <div><dt>Source type</dt><dd>{resource.sourceType}</dd></div>
                          <div><dt>Sensitivity</dt><dd>{resource.sensitivity}</dd></div>
                          <div><dt>Ingest</dt><dd>{ingestStateLabel(resource)}</dd></div>
                          {resource.ingest.lastFailureCode ? (
                            <div><dt>Failure code</dt><dd>{resource.ingest.lastFailureCode}</dd></div>
                          ) : null}
                        </dl>
                        {previewUrl || resource.sourceUri ? (
                          <div className="flex items-center gap-2">
                            {previewUrl ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                leadingIcon="ph:globe"
                                onClick={() => setBrowserPreview({ title: resource.title, url: previewUrl })}
                              >
                                Preview in browser
                              </Button>
                            ) : null}
                            {resource.sourceUri ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                trailingIcon="ph:arrow-square-out"
                                onClick={() => context.openUrl(resource.sourceUri!)}
                              >
                                Open source
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {confirmingDelete ? (
                      <div className="research-res-catalog-row__confirm" role="alert">
                        <span>
                          Delete this resource? This permanently deletes its durable local snapshots and
                          evidence. This can’t be undone.
                        </span>
                        <Button
                          size="xs"
                          variant="danger-ghost"
                          loading={resourceMutationBusy === resource.id}
                          onClick={() => void deleteResource(resource)}
                        >
                          Delete resource
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setConfirmingResourceId(null)}>
                          Keep resource
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

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
      ) : groups.length === 0 && (local.result?.hits.length ?? 0) > 0 ? null : groups.length === 0 ? (
        <div className="research-res__empty research-res__empty--filtered">
          <span>Nothing matches “{trimmedQuery}” — try a different term or clear the filter.</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              updateResourceQuery("");
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
                const article = link.xArticle;
                const resource = resourceByLegacyId.get(link.id);
                return (
                  <article
                    key={link.id}
                    className="research-res-card"
                    data-view={view}
                    data-category={link.category}
                  >
                    <div className="research-res-card__head">
                      <span className={
                        "research-res-card__chip" +
                        (article ? " research-res-card__chip--x-article" : "")
                      }>
                        <Icon
                          name={article ? "ph:newspaper" : linkCategoryMeta(link.category).icon}
                          width={11}
                          height={11}
                          aria-hidden
                        />
                        {article ? "X Article" : linkCategoryMeta(link.category).label}
                      </span>
                      {article ? (
                        <span className="research-res-card__article-meta">
                          <span>{article.author.displayName ?? `@${article.author.username}`}</span>
                          <span>
                            <RelativeTime iso={article.publishedAt} fallback="date unavailable" />
                          </span>
                        </span>
                      ) : (
                        <span className="research-res-card__saved">
                          saved <RelativeTime iso={link.addedAt} fallback="just now" />
                        </span>
                      )}
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
                    {article ? (
                      <p className="research-res-card__excerpt">{article.excerpt}</p>
                    ) : null}
                    <span className="research-res-card__sub">{linkDomain(link.url)}</span>
                    <div className="research-res-card__footer">
                      <span className="research-res-card__meta">
                        {resource ? `${resource.ingest.state.replaceAll("_", " ")} · ` : ""}{cited.length > 0
                          ? `Cited by ${cited.length} ${cited.length === 1 ? "run" : "runs"}`
                          : "Not cited yet"}
                      </span>
                      <div className="research-res-card__buttons">
                        {resource?.ingest.state === "failed" && resource.ingest.retryable !== false ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            loading={resourceMutationBusy === resource.id}
                            onClick={() => void retryResource(resource)}
                          >
                            Retry ingestion
                          </Button>
                        ) : null}
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
        <div
          className="research-res-overlay"
          data-reader={reading && readerExpanded || undefined}
          onClick={closeOverlay}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="research-res-overlay-title"
            className="research-res-overlay__dialog"
            data-expanded={readerExpanded || undefined}
            data-reader={reading && readerExpanded || undefined}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="research-res-overlay__head">
              <span className="research-res-overlay__glyph" aria-hidden>
                <Icon
                  name={openLink.xArticle ? "ph:newspaper" : linkCategoryMeta(openLink.category).icon}
                  width={18}
                  height={18}
                />
              </span>
              <div className="research-res-overlay__heading">
                <div className="research-res-overlay__meta">
                  <span className={
                    "research-res-card__chip" +
                    (openLink.xArticle ? " research-res-card__chip--x-article" : "")
                  }>
                    {openLink.xArticle ? "X Article" : linkCategoryMeta(openLink.category).label}
                  </span>
                  {openLink.xArticle ? (
                    <span className="research-res-overlay__saved">
                      published <RelativeTime iso={openLink.xArticle.publishedAt} fallback="date unavailable" />
                    </span>
                  ) : (
                    <span className="research-res-overlay__saved">
                      saved <RelativeTime iso={openLink.addedAt} fallback="just now" />
                    </span>
                  )}
                </div>
                <h3
                  id="research-res-overlay-title"
                  className={openLink.category === "github" ? "research-res-overlay__title--mono" : undefined}
                >
                  {openLink.title}
                </h3>
                <span className="research-res-overlay__sub">{linkDomain(openLink.url)}</span>
              </div>
              <div className="research-res-overlay__head-actions">
                {openPaperId && reading ? (
                  <>
                    {readerExpanded ? (
                      <button
                        type="button"
                        className="research-res-overlay__close focus-ring"
                        onClick={() => context.openUrl(paperDownloadUrl(openPaperId))}
                        aria-label="Download PDF"
                        title="Download PDF"
                      >
                        <Icon name="ph:download-simple" width={13} height={13} aria-hidden />
                      </button>
                    ) : null}
                    <button
                      ref={readerFocusControlRef}
                      type="button"
                      className="research-res-overlay__close focus-ring"
                      onClick={() => setReaderExpanded((current) => !current)}
                      aria-label={readerExpanded ? "Exit focus reader" : "Enter focus reader"}
                      aria-pressed={readerExpanded}
                      title={readerExpanded ? "Exit focus reader" : "Enter focus reader"}
                    >
                      <Icon
                        name={readerExpanded ? "ph:corners-in" : "ph:corners-out"}
                        width={13}
                        height={13}
                        aria-hidden
                      />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="research-res-overlay__close focus-ring"
                  onClick={closeOverlay}
                  aria-label={reading ? "Close paper reader" : "Close resource details"}
                >
                  <Icon name="ph:x" width={13} height={13} aria-hidden />
                </button>
              </div>
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
              {openLink.xArticle ? (
                <>
                  {openLink.xArticle.coverImageUrl ? (
                    <AuthedImage
                      src={openLink.xArticle.coverImageUrl}
                      alt=""
                      className="research-res-overlay__cover"
                    />
                  ) : null}
                  <div className="research-res-overlay__article-provenance">
                    <span>
                      {openLink.xArticle.author.displayName ?? `@${openLink.xArticle.author.username}`}
                    </span>
                    <span>@{openLink.xArticle.author.username}</span>
                    <span>Source post {openLink.xArticle.sourcePostId}</span>
                    {openLink.xArticle.titleSource === "derived" ? (
                      <span className="research-res-overlay__title-source">
                        Title derived from the article text
                      </span>
                    ) : null}
                  </div>
                  <p className="research-res-overlay__excerpt">{openLink.xArticle.excerpt}</p>
                  {articleDetail?.xArticle ? (
                    <ResearchXArticleReader
                      ref={articleReaderRef}
                      title={articleDetail.title}
                      article={articleDetail.xArticle}
                    />
                  ) : articleLoading ? (
                    <p className="research-res__empty" role="status">Loading article…</p>
                  ) : articleError ? (
                    <p className="research-res__error" role="alert">
                      {articleError}{" "}
                      <Button size="xs" variant="ghost" onClick={() => void readArticle()}>
                        Retry
                      </Button>
                    </p>
                  ) : (
                    <div className="research-res-overlay__read">
                      <div className="research-res-overlay__read-copy">
                        <strong>Read this article here</strong>
                        <span>Opens the saved article text inline.</span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon="ph:book-open"
                        onClick={() => void readArticle()}
                      >
                        Read article
                      </Button>
                    </div>
                  )}
                </>
              ) : null}

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
                      onClick={() => {
                        setReading(true);
                        setReaderExpanded(true);
                      }}
                    >
                      Read
                    </Button>
                  </div>
                )
              ) : null}

              {/* A loaded Article reader replaces the normal resource stats
                  rather than stacking the generic metadata beneath the text. */}
              {!articleDetail?.xArticle ? (
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
              ) : null}

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
                      {openDurableResource
                        ? "Delete this resource? This permanently deletes its durable local snapshots and evidence, and removes it from Resources and quick saves. This can’t be undone."
                        : "Remove this save from Resources and quick saves?"}
                    </span>
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      loading={resourceMutationBusy !== null}
                      onClick={() => void removeOpenLink()}
                    >
                      {openDurableResource ? "Delete resource" : "Remove save"}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirmingRemove(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => setConfirmingRemove(true)}>
                    {openDurableResource ? "Delete resource" : "Remove from saves"}
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
                  variant="ghost"
                  leadingIcon="ph:globe"
                  onClick={() => setBrowserPreview({
                    title: openLink.title,
                    url: (openDurableResource
                      ? researchResourceSourceUrl(openDurableResource)
                      : null) ?? openLink.url,
                  })}
                >
                  Preview in browser
                </Button>
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

      <ResearchResourceBrowserModal
        open={browserPreview !== null}
        onClose={() => setBrowserPreview(null)}
        title={browserPreview?.title ?? ""}
        url={browserPreview?.url ?? null}
        remoteContentRolloutEnabled={caveResearchRemoteContent()}
        /* Resources has no authoritative, explicitly selected Context Pack.
         * The Topic Discovery picker owns private local state and auto-selects
         * its first result, so it cannot be lifted here as consent. Keep the
         * optional consent absent until an explicit owner threads it through. */
        contextPackConsent={undefined}
      />
    </section>
  );
}
