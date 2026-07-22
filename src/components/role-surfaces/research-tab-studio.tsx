"use client";

/**
 * Studio tab (cave-dl74, Phase B4) — turns mission artifacts into shareable
 * drafts via /api/research/generations. Design: "Generations" screen, markup
 * lines 309–533 / logic 877–1109 of the Research Desk App design file.
 *
 * Honesty contract (see src/lib/research-generations.ts):
 * - Sources are ONLY missions with a live markdown artifact (published or
 *   working) — the same rule the server's drafting uses, so the chips never
 *   offer a run the POST would 409.
 * - The five creatable kinds come from RESEARCH_GENERATION_KINDS; the three
 *   media kinds (podcast / short video / long video) render from
 *   RESEARCH_GENERATION_MEDIA_KINDS as visibly disabled cards with their
 *   honest hint — one source of truth, no queued records that never finish.
 * - Statuses are terminal (ready | failed | cancelled — drafting is
 *   synchronous), so the list loads on mount and after mutations. There is
 *   deliberately no polling and no progress bar.
 * - Filter chips cover All + the five real kinds with live counts; podcast /
 *   video filters are omitted because no such record can exist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  RESEARCH_GENERATION_KINDS,
  RESEARCH_GENERATION_MEDIA_KINDS,
  createResearchGeneration,
  listResearchGenerations,
  removeResearchGeneration,
  type ResearchGeneration,
  type ResearchGenerationKind,
} from "@/lib/research-generations";
import type { ResearchTabProps } from "./researcher-surface";
import {
  GenerationConfigModal,
  GenerationViewerModal,
  MarkdownEditorModal,
  STUDIO_KIND_META,
  STUDIO_MEDIA_PRESENTATION,
  generationStatusText,
  generationTitle,
  missionHasMarkdownArtifact,
  useCopyFlash,
  type StudioSourceOption,
} from "./research-studio-modals";

type StudioFilter = "all" | ResearchGenerationKind;

export function ResearchTabStudio({ research, context, onNavigate }: ResearchTabProps) {
  const familiarId = context.activeFamiliar.id;
  const { announce } = useAnnouncer();
  const { flash, copy } = useCopyFlash();

  const [generations, setGenerations] = useState<ResearchGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [configKind, setConfigKind] = useState<ResearchGenerationKind | null>(null);
  const [directions, setDirections] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [filter, setFilter] = useState<StudioFilter>("all");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [mermaidOpenId, setMermaidOpenId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);

  // One load per familiar (plus explicit retry). Statuses are terminal —
  // ready | failed | cancelled, drafting is synchronous — so nothing here can
  // change server-side between visits except through our own mutations, which
  // update the list directly. No polling.
  //
  // Stale-response guard (canonical loadSeq pattern, see
  // familiar-work-queue-view): every load bumps the epoch and responses from
  // an older epoch are discarded, so an in-flight fetch for the previous
  // familiar can never land over the new familiar's rows. On a familiar
  // switch the previous familiar's rows are dropped immediately (the list
  // shows loading/empty, never another familiar's generations) and the kind
  // filter resets to All so a kind that familiar lacks can't strand the view.
  const loadSeq = useRef(0);
  const loadedFamiliarRef = useRef(familiarId);
  useEffect(() => {
    const seq = ++loadSeq.current;
    const controller = new AbortController();
    if (loadedFamiliarRef.current !== familiarId) {
      loadedFamiliarRef.current = familiarId;
      setGenerations([]);
      setFilter("all");
    }
    setLoading(true);
    setListError(null);
    listResearchGenerations(familiarId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || seq !== loadSeq.current) return;
        if (!result.ok || !result.generations) {
          setListError(result.error ?? "Generations could not load");
        } else {
          setGenerations(result.generations);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted || seq !== loadSeq.current) return;
        setListError(error instanceof Error ? error.message : "Generations could not load");
        setLoading(false);
      });
    return () => controller.abort();
  }, [familiarId, reloadTick]);

  // Real sources: missions the server would actually draft from.
  const sources = useMemo<StudioSourceOption[]>(
    () =>
      research.missions
        .filter(missionHasMarkdownArtifact)
        .map((mission) => ({ id: mission.id, title: mission.title })),
    [research.missions],
  );
  const effectiveSourceId =
    sourceId !== null && sources.some((source) => source.id === sourceId)
      ? sourceId
      : (sources[0]?.id ?? null);

  const counts = useMemo(() => {
    const byKind = new Map<StudioFilter, number>([["all", generations.length]]);
    for (const kind of RESEARCH_GENERATION_KINDS) {
      byKind.set(kind, generations.filter((generation) => generation.kind === kind).length);
    }
    return byKind;
  }, [generations]);

  const visible = useMemo(() => {
    const sorted = [...generations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter === "all" ? sorted : sorted.filter((generation) => generation.kind === filter);
  }, [generations, filter]);

  const openConfig = useCallback((kind: ResearchGenerationKind) => {
    setCreateError(null);
    setDirections("");
    setConfigKind(kind);
  }, []);

  const submitCreate = useCallback(async () => {
    if (!configKind || !effectiveSourceId) return;
    setCreating(true);
    setCreateError(null);
    const trimmed = directions.trim();
    const result = await createResearchGeneration({
      familiarId,
      kind: configKind,
      sourceMissionId: effectiveSourceId,
      ...(trimmed ? { directions: trimmed } : {}),
    }).catch((error) => ({
      ok: false as const,
      generation: undefined,
      error: error instanceof Error ? error.message : "Generation failed",
    }));
    setCreating(false);
    if (!result.ok || !result.generation) {
      // Surfaces the server's own message inline — notably the 409 when the
      // mission has no markdown artifact yet.
      setCreateError(result.error ?? "Generation failed");
      return;
    }
    const created = result.generation;
    setGenerations((prev) => [created, ...prev.filter((g) => g.id !== created.id)]);
    setConfigKind(null);
    setDirections("");
    announce(`${STUDIO_KIND_META[created.kind].label} drafted from ${created.sourceTitle}`);
  }, [announce, configKind, directions, effectiveSourceId, familiarId]);

  const confirmRemove = useCallback(
    async (generation: ResearchGeneration) => {
      setRemoveError(null);
      setRemovingId(generation.id);
      const result = await removeResearchGeneration(generation.id, familiarId).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "Remove failed",
      }));
      setRemovingId(null);
      setConfirmRemoveId(null);
      // The DELETE route 404s ("generation not found") when the record is
      // already gone server-side — that outcome IS the removal, so drop the
      // row locally instead of stranding a phantom entry behind an error.
      const alreadyGone = !result.ok && result.error === "generation not found";
      if (!result.ok && !alreadyGone) {
        setRemoveError({ id: generation.id, message: result.error ?? "Remove failed" });
        return;
      }
      setGenerations((prev) => prev.filter((g) => g.id !== generation.id));
      setViewerId((current) => (current === generation.id ? null : current));
      setEditorId((current) => (current === generation.id ? null : current));
      announce(`${STUDIO_KIND_META[generation.kind].label} removed`);
    },
    [announce, familiarId],
  );

  const viewerGeneration = generations.find((generation) => generation.id === viewerId) ?? null;
  const editorGeneration = generations.find((generation) => generation.id === editorId) ?? null;

  return (
    <section className="research-studio" aria-label="Research studio">
      <header className="research-studio__header">
        <h2>Studio</h2>
        <p>Turn finished research into shareable drafts — extracted from each run&rsquo;s cited findings.</p>
      </header>

      <div className="research-studio__sources" role="group" aria-label="Generation source">
        <span className="research-studio__sources-label">Source:</span>
        {sources.length === 0 ? (
          <span className="research-studio__sources-hint">
            No runs with a markdown artifact yet — the Studio drafts from finished research.
          </span>
        ) : (
          <div className="research-studio__chips">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="research-studio__chip"
                aria-pressed={source.id === effectiveSourceId}
                onClick={() => setSourceId(source.id)}
              >
                {source.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="research-studio__grid">
        {RESEARCH_GENERATION_KINDS.map((kind) => {
          const meta = STUDIO_KIND_META[kind];
          return (
            <button
              key={kind}
              type="button"
              className="research-studio-card"
              data-kind={kind}
              disabled={sources.length === 0}
              aria-haspopup="dialog"
              onClick={() => openConfig(kind)}
            >
              <span className="research-studio-card__tile" aria-hidden>
                {meta.glyph}
              </span>
              <span className="research-studio-card__body">
                <span className="research-studio-card__head">
                  <strong>{meta.label}</strong>
                  <i className="research-studio-card__format">{meta.format}</i>
                </span>
                <span className="research-studio-card__blurb">{meta.blurb}</span>
                <span className="research-studio-card__tags">
                  {meta.tags.map((tag) => (
                    <span key={tag} className="research-studio-card__tag">
                      {tag}
                    </span>
                  ))}
                </span>
                {sources.length === 0 ? (
                  <span className="research-studio-card__hint">
                    Needs a run with a markdown artifact.
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        {RESEARCH_GENERATION_MEDIA_KINDS.map((media) => {
          const presentation = STUDIO_MEDIA_PRESENTATION[media.kind];
          return (
            // Deliberately not a <button>: these kinds cannot be created in
            // this build. The hint is visible on the card itself, not tucked
            // into a tooltip, and aria-disabled tells AT the same story.
            <div
              key={media.kind}
              className="research-studio-card research-studio-card--media"
              data-kind={media.kind}
              aria-disabled="true"
            >
              <span className="research-studio-card__tile" aria-hidden>
                {presentation.glyph}
              </span>
              <span className="research-studio-card__body">
                <span className="research-studio-card__head">
                  <strong>{media.label}</strong>
                  <i className="research-studio-card__format">{presentation.format}</i>
                </span>
                <span className="research-studio-card__hint">{media.hint}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="research-studio__list-head">
        <h3>Recent generations</h3>
        <span className="research-studio__list-count">{generations.length}</span>
        <div
          className="research-studio__filters"
          role="group"
          aria-label="Filter generations by kind"
        >
          <button
            type="button"
            className="research-studio__chip research-studio__chip--filter"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All <span className="research-studio__chip-count">{counts.get("all") ?? 0}</span>
          </button>
          {RESEARCH_GENERATION_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="research-studio__chip research-studio__chip--filter"
              aria-pressed={filter === kind}
              disabled={(counts.get(kind) ?? 0) === 0}
              onClick={() => setFilter(kind)}
            >
              {STUDIO_KIND_META[kind].label}{" "}
              <span className="research-studio__chip-count">{counts.get(kind) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="research-studio__note">Loading generations…</p> : null}
      {listError ? (
        <p className="research-studio__error" role="alert">
          {listError}{" "}
          <button
            type="button"
            className="research-studio-act research-studio-act--tiny"
            onClick={() => setReloadTick((tick) => tick + 1)}
          >
            Retry
          </button>
        </p>
      ) : null}

      {!loading && !listError && generations.length === 0 ? (
        <div className="research-studio__empty">
          <p>
            Generations draft from finished research — complete a run, then turn it into a
            diagram, thread, or draft post.
          </p>
          {sources.length === 0 ? (
            <button
              type="button"
              className="research-studio-act research-studio-act--accent"
              onClick={() => onNavigate("prompt")}
            >
              Start a research run
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !listError && generations.length > 0 && visible.length === 0 ? (
        <p className="research-studio__note">No {filter} generations.</p>
      ) : null}

      <ul className="research-studio__list">
        {visible.map((generation) => {
          const meta = STUDIO_KIND_META[generation.kind];
          const title = generationTitle(generation);
          const canOpen = generation.status === "ready" && Boolean(generation.content);
          const mermaid =
            generation.content?.kind === "diagram" ? generation.content.mermaid : null;
          const mermaidOpen = mermaidOpenId === generation.id && mermaid !== null;
          const removing = removingId === generation.id;
          return (
            <li key={generation.id} className="research-studio-row" data-kind={generation.kind}>
              <span className="research-studio-row__tile" aria-hidden>
                {meta.glyph}
              </span>
              <div className="research-studio-row__body">
                <div className="research-studio-row__meta">
                  <span className="research-studio__kicker">{meta.label}</span>
                  <span className="research-studio-row__from">
                    from {generation.sourceTitle} ·{" "}
                    <RelativeTime iso={generation.createdAt} fallback="just now" />
                  </span>
                </div>
                {canOpen ? (
                  <button
                    type="button"
                    className="research-studio-row__title"
                    onClick={() => setViewerId(generation.id)}
                  >
                    {title}
                  </button>
                ) : (
                  <strong className="research-studio-row__title research-studio-row__title--static">
                    {title}
                  </strong>
                )}
                {generation.directions ? (
                  <span className="research-studio-row__directions">
                    Directions: {generation.directions}
                  </span>
                ) : null}
                <span className="research-studio-row__status" data-status={generation.status}>
                  {generationStatusText(generation)}
                </span>
                {mermaidOpen ? <pre className="research-studio__code">{mermaid}</pre> : null}
                {removeError?.id === generation.id ? (
                  <span className="research-studio__error" role="alert">
                    {removeError.message}
                  </span>
                ) : null}
              </div>
              <div className="research-studio-row__acts">
                {mermaid !== null ? (
                  <>
                    <button
                      type="button"
                      className="research-studio-act"
                      aria-expanded={mermaidOpen}
                      onClick={() =>
                        setMermaidOpenId((current) =>
                          current === generation.id ? null : generation.id,
                        )
                      }
                    >
                      {mermaidOpen ? "⌗ Hide Mermaid" : "⌗ View Mermaid"}
                    </button>
                    <button
                      type="button"
                      className="research-studio-act"
                      data-flash={flash === `row-${generation.id}`}
                      onClick={() => copy(`row-${generation.id}`, mermaid)}
                    >
                      {flash === `row-${generation.id}` ? "✓ Copied" : "⧉ Copy Mermaid"}
                    </button>
                  </>
                ) : null}
                {canOpen && generation.kind !== "diagram" ? (
                  <button
                    type="button"
                    className="research-studio-act"
                    onClick={() => setViewerId(generation.id)}
                  >
                    {generation.kind === "blog" ? "↗ Open draft" : "↗ Open"}
                  </button>
                ) : null}
                {confirmRemoveId === generation.id ? (
                  <span className="research-studio-row__confirm">
                    <span>Remove?</span>
                    <button
                      type="button"
                      className="research-studio-act research-studio-act--danger"
                      disabled={removing}
                      onClick={() => confirmRemove(generation)}
                    >
                      {removing ? "Removing…" : "Remove"}
                    </button>
                    <button
                      type="button"
                      className="research-studio-act"
                      disabled={removing}
                      onClick={() => setConfirmRemoveId(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="research-studio-act"
                    onClick={() => {
                      setRemoveError(null);
                      setConfirmRemoveId(generation.id);
                    }}
                  >
                    ✕ Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {configKind ? (
        <GenerationConfigModal
          kind={configKind}
          sources={sources}
          selectedSourceId={effectiveSourceId}
          onSelectSource={setSourceId}
          directions={directions}
          onDirectionsChange={setDirections}
          error={createError}
          creating={creating}
          onSubmit={submitCreate}
          onClose={() => setConfigKind(null)}
        />
      ) : null}

      {viewerGeneration ? (
        <GenerationViewerModal
          generation={viewerGeneration}
          // While the editor is stacked on top, park the viewer: one live
          // focus trap and one Escape target at a time (first Escape closes
          // only the editor; the second closes the viewer).
          active={editorGeneration === null}
          onClose={() => setViewerId(null)}
          onOpenEditor={
            viewerGeneration.content?.kind === "blog"
              ? () => setEditorId(viewerGeneration.id)
              : undefined
          }
        />
      ) : null}

      {editorGeneration ? (
        <MarkdownEditorModal generation={editorGeneration} onClose={() => setEditorId(null)} />
      ) : null}
    </section>
  );
}
