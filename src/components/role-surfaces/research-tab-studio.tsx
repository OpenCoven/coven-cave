"use client";

/**
 * Studio tab (cave-dl74, Phase B4) — turns mission artifacts into shareable
 * drafts via /api/research/generations. Design: "Generations" screen, markup
 * lines 309–533 / logic 877–1109 of the Research Desk App design file.
 *
 * Honesty contract (see src/lib/research-generations.ts):
 * - Sources are ONLY missions with a live markdown artifact (published or
 *   working) — the same rule the server's drafting uses, so the source
 *   dropdown never offers a run the POST would 409.
 * - Media cards are creatable only when the live readiness endpoint says they
 *   are ready; an unavailable card carries its remediation hint in place.
 * - Extractive rows are terminal. Generation rows poll only while media is
 *   queued/rendering; readiness refreshes separately at a low frequency.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  RESEARCH_GENERATION_CREATABLE_KINDS,
  RESEARCH_GENERATION_MEDIA_KINDS,
  cancelResearchGeneration,
  createResearchGeneration,
  getResearchGenerationReadiness,
  isResearchGenerationKind,
  listResearchGenerations,
  renderResearchGeneration,
  removeResearchGeneration,
  type ResearchGeneration,
  type ResearchGenerationCreatableKind,
  type ResearchGenerationReadiness,
  type ResearchMediaLength,
  type ResearchMediaProvider,
  type ResearchPodcastStyle,
} from "@/lib/research-generations";
import type { ResearchTabProps } from "./researcher-surface";
import { describeProviderChips, researchProviderChips } from "./research-studio-providers";
import {
  GenerationConfigModal,
  GenerationReviewModal,
  GenerationViewerModal,
  MarkdownEditorModal,
  StudioMermaidDiagram,
  generationStatusText,
  generationTitle,
  missionHasMarkdownArtifact,
  studioMetaForKind,
  useCopyFlash,
  type StudioSourceOption,
} from "./research-studio-modals";

type StudioFilter = "all" | ResearchGenerationCreatableKind;

export function ResearchTabStudio({ research, context, onNavigate }: ResearchTabProps) {
  const familiarId = context.activeFamiliar.id;
  const { announce } = useAnnouncer();
  const { flash, copy } = useCopyFlash();

  const [generations, setGenerations] = useState<ResearchGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ResearchGenerationReadiness | null>(null);
  const providerChips = useMemo(() => researchProviderChips(readiness), [readiness]);

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [configKind, setConfigKind] = useState<ResearchGenerationCreatableKind | null>(null);
  const [directions, setDirections] = useState("");
  const [mediaProvider, setMediaProvider] =
    useState<ResearchMediaProvider>("local");
  const [mediaVoice, setMediaVoice] = useState("");
  const [mediaGuestVoice, setMediaGuestVoice] = useState("");
  const [mediaStyle, setMediaStyle] = useState<ResearchPodcastStyle>("breakdown");
  const [mediaLength, setMediaLength] =
    useState<ResearchMediaLength>("standard");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewGeneration, setReviewGeneration] = useState<ResearchGeneration | null>(null);
  const [renderingReview, setRenderingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [filter, setFilter] = useState<StudioFilter>("all");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [mermaidOpenId, setMermaidOpenId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // One load per familiar plus explicit retry. The same effect is also the
  // small polling loop for active media rows; terminal-only Studios stay idle.
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
  const previousGenerationsRef = useRef<Map<string, ResearchGeneration["status"]>>(new Map());
  const listInFlightRef = useRef(false);
  const listControllerRef = useRef<AbortController | null>(null);
  const readinessInFlightRef = useRef(false);
  const readinessControllerRef = useRef<AbortController | null>(null);
  const retryInFlightRef = useRef<string | null>(null);

  const loadGenerations = useCallback(async (showLoading: boolean) => {
    if (listInFlightRef.current) return;
    listInFlightRef.current = true;
    const seq = ++loadSeq.current;
    const controller = new AbortController();
    listControllerRef.current = controller;
    if (showLoading) {
      setLoading(true);
      setListError(null);
    }
    try {
      const result = await listResearchGenerations(
        familiarId,
        controller.signal,
      );
      if (controller.signal.aborted || seq !== loadSeq.current) return;
      if (!result.ok || !result.generations) {
        setListError(result.error ?? "Generations could not load");
        return;
      }
      const previous = previousGenerationsRef.current;
      setGenerations(result.generations);
      setListError(null);
      previousGenerationsRef.current = new Map(
        result.generations.map((generation) => [
          generation.id,
          generation.status,
        ]),
      );
      for (const generation of result.generations) {
        const before = previous.get(generation.id);
        if (
          before &&
          before !== generation.status &&
          generation.status === "ready"
        ) {
          announce(`${studioMetaForKind(generation.kind).label} is ready`);
        }
        if (
          before &&
          before !== generation.status &&
          generation.status === "failed"
        ) {
          announce(
            `${studioMetaForKind(generation.kind).label} failed`,
            "assertive",
          );
        }
      }
    } catch (error) {
      if (controller.signal.aborted || seq !== loadSeq.current) return;
      setListError(
        error instanceof Error
          ? error.message
          : "Generations could not load",
      );
    } finally {
      if (listControllerRef.current === controller) {
        listControllerRef.current = null;
        listInFlightRef.current = false;
      }
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [announce, familiarId]);

  const loadReadiness = useCallback(async () => {
    if (readinessInFlightRef.current) return;
    readinessInFlightRef.current = true;
    const controller = new AbortController();
    readinessControllerRef.current = controller;
    try {
      const result = await getResearchGenerationReadiness(controller.signal);
      if (!controller.signal.aborted && result.ok) setReadiness(result);
    } catch {
      // Keep the last verified readiness snapshot through transient failures.
    } finally {
      if (readinessControllerRef.current === controller) {
        readinessControllerRef.current = null;
        readinessInFlightRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (loadedFamiliarRef.current !== familiarId) {
      loadedFamiliarRef.current = familiarId;
      setGenerations([]);
      setFilter("all");
      previousGenerationsRef.current = new Map();
    }
    void loadGenerations(true);
    return () => {
      loadSeq.current += 1;
      listControllerRef.current?.abort();
      listControllerRef.current = null;
      listInFlightRef.current = false;
    };
  }, [familiarId, loadGenerations]);

  useEffect(() => {
    void loadReadiness();
    return () => {
      readinessControllerRef.current?.abort();
      readinessControllerRef.current = null;
      readinessInFlightRef.current = false;
    };
  }, [loadReadiness]);

  const hasActiveMediaGeneration = generations.some((generation) =>
    !isResearchGenerationKind(generation.kind) &&
    (generation.status === "queued" || generation.status === "rendering")
  );
  usePausablePoll(
    () => {
      void loadGenerations(false);
    },
    1_500,
    { enabled: hasActiveMediaGeneration },
  );
  usePausablePoll(
    () => {
      void loadReadiness();
    },
    30_000,
  );

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
    for (const kind of RESEARCH_GENERATION_CREATABLE_KINDS) {
      byKind.set(kind, generations.filter((generation) => generation.kind === kind).length);
    }
    return byKind;
  }, [generations]);

  const visible = useMemo(() => {
    const sorted = [...generations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter === "all" ? sorted : sorted.filter((generation) => generation.kind === filter);
  }, [generations, filter]);

  const openConfig = useCallback((kind: ResearchGenerationCreatableKind) => {
    setCreateError(null);
    setDirections("");
    if (!isResearchGenerationKind(kind) && readiness) {
      const elevenLabsShortVideoDefaultIsReady =
        kind === "short-video" &&
        readiness.providers.elevenlabs.ready &&
        readiness.providers.elevenlabs.defaultVoiceId.trim().length > 0;
      const localSelectionIsValid =
        mediaProvider === "local" &&
        readiness.providers.local.ready &&
        readiness.providers.local.voices.some(
          (voice) => voice.id === mediaVoice,
        );
      const elevenLabsSelectionIsValid =
        mediaProvider === "elevenlabs" &&
        readiness.providers.elevenlabs.ready &&
        mediaVoice.trim().length > 0;
      if (elevenLabsShortVideoDefaultIsReady) {
        setMediaProvider("elevenlabs");
        setMediaVoice(readiness.providers.elevenlabs.defaultVoiceId);
      } else if (!localSelectionIsValid && !elevenLabsSelectionIsValid) {
        const firstLocalVoice = readiness.providers.local.voices[0];
        if (readiness.providers.local.ready && firstLocalVoice) {
          setMediaProvider("local");
          setMediaVoice(firstLocalVoice.id);
        } else if (readiness.providers.elevenlabs.ready) {
          setMediaProvider("elevenlabs");
          setMediaVoice(readiness.providers.elevenlabs.defaultVoiceId);
        }
      }
      if (kind === "short-video") {
        setMediaLength("standard");
      }
    }
    setConfigKind(kind);
  }, [mediaLength, mediaProvider, mediaVoice, readiness]);

  const submitCreate = useCallback(async () => {
    if (!configKind || !effectiveSourceId) return;
    setCreating(true);
    setCreateError(null);
    const hasDirections = directions.trim().length > 0;
    const result = await createResearchGeneration({
      familiarId,
      kind: configKind,
      sourceMissionId: effectiveSourceId,
      ...(hasDirections ? { directions } : {}),
      ...(!isResearchGenerationKind(configKind)
        ? {
            renderConfig: {
              provider: mediaProvider,
              voice: mediaVoice,
              length: mediaLength,
              ...(configKind === "podcast" &&
              mediaStyle !== "recap" &&
              mediaGuestVoice.trim().length > 0
                ? {
                    voices: {
                      host: mediaVoice,
                      guest: mediaGuestVoice.trim(),
                    },
                  }
                : {}),
              ...(configKind === "podcast" ? { style: mediaStyle } : {}),
            },
          }
        : {}),
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
    if (isResearchGenerationKind(created.kind)) {
      announce(`${studioMetaForKind(created.kind).label} drafted from ${created.sourceTitle}`);
    } else {
      setReviewError(null);
      setReviewGeneration(created);
      announce(`${studioMetaForKind(created.kind).label} draft ready for review`);
    }
  }, [
    announce,
    configKind,
    directions,
    effectiveSourceId,
    familiarId,
    mediaGuestVoice,
    mediaLength,
    mediaProvider,
    mediaStyle,
    mediaVoice,
  ]);

  const renderReview = useCallback(async () => {
    if (!reviewGeneration) return;
    setRenderingReview(true);
    setReviewError(null);
    const result = await renderResearchGeneration(reviewGeneration.id, familiarId).catch((error) => ({
      ok: false as const,
      generation: undefined,
      error: error instanceof Error ? error.message : "Render failed",
    }));
    setRenderingReview(false);
    if (!result.ok || !result.generation) {
      setReviewError(result.error ?? "Render failed");
      return;
    }
    setGenerations((previous) => previous.map((entry) => entry.id === result.generation!.id ? result.generation! : entry));
    setReviewGeneration(null);
    announce(`${studioMetaForKind(result.generation.kind).label} render queued`);
  }, [announce, familiarId, reviewGeneration]);

  const cancelGeneration = useCallback(async (generation: ResearchGeneration) => {
    const result = await cancelResearchGeneration(generation.id, familiarId).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Cancel failed",
    }));
    if (!result.ok || !result.generation) {
      setListError(result.error ?? "Cancel failed");
      return;
    }
    setGenerations((previous) =>
      previous.map((entry) =>
        entry.id === result.generation!.id ? result.generation! : entry,
      ),
    );
    announce(`${studioMetaForKind(generation.kind).label} cancelled`);
  }, [announce, familiarId]);

  const retryGeneration = useCallback(async (generation: ResearchGeneration) => {
    if (retryInFlightRef.current) return;
    retryInFlightRef.current = generation.id;
    setRetryingId(generation.id);
    const result = await createResearchGeneration({
        familiarId,
        kind: generation.kind,
        sourceMissionId: generation.sourceMissionId,
        ...(generation.directions ? { directions: generation.directions } : {}),
        ...(generation.renderConfig ? { renderConfig: generation.renderConfig } : {}),
      })
      .catch((error) => ({
        ok: false as const,
        generation: undefined,
        error: error instanceof Error ? error.message : "Retry failed",
      }))
      .finally(() => {
        retryInFlightRef.current = null;
        setRetryingId(null);
      });
    if (!result.ok || !result.generation) {
      setListError(result.error ?? "Retry failed");
      return;
    }
    setGenerations((previous) => [
      result.generation!,
      ...previous.filter((entry) => entry.id !== result.generation!.id),
    ]);
    setReviewError(null);
    setReviewGeneration(result.generation);
    announce(`${studioMetaForKind(generation.kind).label} draft ready for review`);
  }, [announce, familiarId]);

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
      announce(`${studioMetaForKind(generation.kind).label} removed`);
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
        {/* Provider strip: why a card is disabled, before you click it. Each
            chip carries the readiness endpoint's own hint, so the chip and the
            card it blocks say the same thing. */}
        <div
          className="research-studio__providers"
          role="group"
          aria-label={describeProviderChips(providerChips)}
        >
          {providerChips.map((chip) => (
            <span
              key={chip.id}
              className="research-studio__provider"
              data-state={chip.state}
              title={`${chip.name} — ${chip.detail}`}
            >
              <i aria-hidden />
              {chip.name}
              <span className="sr-only"> — {chip.detail}</span>
            </span>
          ))}
        </div>
      </header>

      <div className="research-studio__sources">
        {sources.length === 0 ? (
          <>
            <span className="research-studio__sources-label">Draft from</span>
            <span className="research-studio__sources-hint">
              No runs with a markdown artifact yet — the Studio drafts from finished research.
            </span>
          </>
        ) : (
          <>
            <label className="research-studio__sources-label" htmlFor="research-studio-source">
              Draft from
            </label>
            <select
              id="research-studio-source"
              className="research-studio__select"
              value={effectiveSourceId ?? ""}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="research-studio__grid">
        {RESEARCH_GENERATION_CREATABLE_KINDS.map((kind) => {
          const meta = studioMetaForKind(kind);
          const mediaEntry = RESEARCH_GENERATION_MEDIA_KINDS.find((entry) => entry.kind === kind);
          const mediaReady = !mediaEntry || Boolean(
            readiness && (
              kind === "podcast" ? readiness.podcast.ready
                : kind === "short-video" ? readiness.shortVideo.ready
                  : readiness.longVideo.ready
            ),
          );
          const hint = sources.length === 0
            ? "Needs a run with a markdown artifact."
            : !mediaReady
              ? (kind === "podcast" ? readiness?.podcast.hint
                : kind === "short-video" ? readiness?.shortVideo.hint
                  : readiness?.longVideo.hint) ?? "Media readiness is still loading."
              : null;
          return (
            <button
              key={kind}
              type="button"
              className={`research-studio-card${mediaEntry ? " research-studio-card--media" : ""}`}
              data-kind={kind}
              disabled={sources.length === 0 || !mediaReady}
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
                {hint ? (
                  <span className="research-studio-card__hint">
                    {hint}
                  </span>
                ) : null}
              </span>
            </button>
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
          {RESEARCH_GENERATION_CREATABLE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="research-studio__chip research-studio__chip--filter"
              aria-pressed={filter === kind}
              disabled={(counts.get(kind) ?? 0) === 0}
              onClick={() => setFilter(kind)}
            >
              {studioMetaForKind(kind).label}{" "}
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
            onClick={() => {
              void loadGenerations(true);
              void loadReadiness();
            }}
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
          const meta = studioMetaForKind(generation.kind);
          const title = generationTitle(generation);
          const canOpen = generation.status === "ready" && Boolean(generation.content);
          const mermaid =
            generation.content?.kind === "diagram" ? generation.content.mermaid : null;
          const mermaidOpen = mermaidOpenId === generation.id && mermaid !== null;
          const removing = removingId === generation.id;
          const mediaActive = !isResearchGenerationKind(generation.kind) &&
            (generation.status === "queued" || generation.status === "rendering");
          return (
            <li
              key={generation.id}
              className="research-studio-row"
              data-kind={generation.kind}
              data-generation-id={generation.id}
            >
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
                {mermaidOpen ? (
                  <div className="research-studio-row__diagram">
                    <StudioMermaidDiagram mermaid={mermaid} />
                  </div>
                ) : null}
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
                      {mermaidOpen ? "◇ Hide diagram" : "◇ View diagram"}
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
                {mediaActive ? (
                  <button
                    type="button"
                    className="research-studio-act research-studio-act--danger"
                    onClick={() => cancelGeneration(generation)}
                  >
                    Cancel
                  </button>
                ) : null}
                {!isResearchGenerationKind(generation.kind) &&
                generation.status === "draft" ? (
                  <button
                    type="button"
                    className="research-studio-act"
                    onClick={() => {
                      setReviewError(null);
                      setReviewGeneration(generation);
                    }}
                  >
                    Review draft
                  </button>
                ) : null}
                {!mediaActive && !isResearchGenerationKind(generation.kind) && generation.status === "failed" ? (
                  <button
                    type="button"
                    className="research-studio-act"
                    disabled={retryingId !== null}
                    onClick={() => retryGeneration(generation)}
                  >
                    {retryingId === generation.id ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
                {!mediaActive && (confirmRemoveId === generation.id ? (
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
                ))}
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
          readiness={readiness}
          mediaProvider={mediaProvider}
          onMediaProviderChange={(provider) => {
            setMediaProvider(provider);
            // Guest voices are provider-specific; a stale one must not leak
            // into the other provider's render config.
            setMediaGuestVoice("");
          }}
          mediaVoice={mediaVoice}
          onMediaVoiceChange={setMediaVoice}
          mediaGuestVoice={mediaGuestVoice}
          onMediaGuestVoiceChange={setMediaGuestVoice}
          mediaStyle={mediaStyle}
          onMediaStyleChange={setMediaStyle}
          mediaLength={mediaLength}
          onMediaLengthChange={setMediaLength}
          error={createError}
          creating={creating}
          onSubmit={submitCreate}
          onClose={() => setConfigKind(null)}
        />
      ) : null}

      {reviewGeneration ? (
        <GenerationReviewModal
          generation={reviewGeneration}
          rendering={renderingReview}
          error={reviewError}
          onRender={renderReview}
          onClose={() => setReviewGeneration(null)}
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
