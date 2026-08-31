"use client";

/**
 * Prompt tab — the handoff's "New research" screen.
 *
 * Hero line, the intake engine (research-mission-composer.tsx: slash palette,
 * ✦ Improve, prompt builder, strength meter, angle chips, mode cards, bounds
 * disclosure), and the Quick saves drawer docked to the bottom of the surface.
 *
 * The drawer is collapsed by default and lifts over the intake when opened —
 * the frame's shape, and the reason the intake itself no longer has to compete
 * with a permanently-open list. Rows toggle an attach state that renders as
 * "Related context" chips inside the composer card. On Start research the
 * selected IDs cross the creation boundary, so ordinary links and saved
 * Articles are persisted before the first run begins and the desk opens on
 * the new mission.
 *
 * Grouping is REAL data only: a "✦ Suggested for this prompt" group matched
 * against the live draft, then one group per saved-link category, then the
 * remainder. Suggested-angle seeds and recommendations are likewise derived
 * from real mission and link titles — with neither, those affordances simply
 * do not render.
 */

import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgenticRecommendationCard,
  type AgenticRecommendationCardState,
} from "@/components/agentic-recommendation-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  parseAgenticRecommendationsOutput,
  type AgenticRecommendation,
} from "@/lib/agentic-recommendations";
import { linkCategoryMeta, type SavedLinkSummary } from "@/lib/link-organizer";
import {
  buildResearchRecommendationContext,
  researchRecommendationContextKey,
  type ResearchRecommendationClientContext,
} from "@/lib/research-recommendation-context";
import type { ResearchMissionMode } from "@/lib/research-missions";
import { promptRecommendations } from "@/lib/research-prompt-brief";
import type {
  ResearchTopicRecommendation,
  ResearchTopicRecommendationPayload,
} from "@/lib/research-topic-recommendations";
import { createResearchMissionInputFromIntent } from "@/lib/research-mission-routing";
import { relativeTime } from "@/lib/relative-time";
import { useAgenticRecommendations } from "@/lib/use-agentic-recommendations";
import {
  matchSavedLinks,
  updateVisibleQuickSaveSelection,
  type QuickSaveGroup,
} from "./research-quick-saves";
import {
  ResearchMissionComposer,
  type AttachedResearchLink,
} from "./research-mission-composer";
import { ResearchTopicDecisionCard } from "./research-topic-decision-card";
import type { ResearchTabProps } from "./researcher-surface";
import { useResearchLinks } from "./use-research-links";
import type { TopicProposalDraftV1 } from "@/lib/research-topic-discovery";

export type ResearchTabPromptProps = ResearchTabProps & {
  /** Composer mode preselected by cross-tab navigation. */
  initialMode?: ResearchMissionMode;
  /** An accepted Topic Discovery proposal pre-fills the composer once. */
  initialDraft?: TopicProposalDraftV1;
};

/** How many recent titles feed the suggested-angle rotation from each pool. */
const ANGLE_SEEDS_PER_POOL = 6;
const REDUCED_CONTEXT_REASON = "Vault context was unavailable, so this ranking uses Research Desk evidence only.";

type ResearchRecommendationsResponse = {
  ok?: boolean;
  recommendations?: ResearchTopicRecommendation[];
  contextFingerprint?: string;
  reducedContext?: boolean;
};

type ResearchRecommendationSnapshot = {
  clientContextKey: string;
  serverContextFingerprint: string;
  recommendations: Map<string, ResearchTopicRecommendation>;
};

function parseResearchTopicRecommendations(text: string): AgenticRecommendation[] {
  return parseAgenticRecommendationsOutput(text).map((recommendation, index) => ({
    ...recommendation,
    ordinal: index + 1,
  }));
}

function researchTopicPayload(
  recommendation: AgenticRecommendation,
): ResearchTopicRecommendationPayload | null {
  const payload = recommendation.payload;
  const recommendationKind = payload.recommendationKind;
  if (
    recommendation.surface !== "research"
    || recommendation.kind !== "topic"
    || typeof recommendationKind !== "string"
    || !["start-mission", "refine-mission", "review-mission", "add-to-prompt", "investigate-evidence-gap"]
      .includes(recommendationKind)
    || typeof payload.topic !== "string"
  ) {
    return null;
  }
  if (
    (payload.targetMissionId !== undefined && typeof payload.targetMissionId !== "string")
    || (payload.sourceId !== undefined && typeof payload.sourceId !== "string")
  ) {
    return null;
  }
  return payload as ResearchTopicRecommendationPayload;
}

function topicActionLabel(payload: ResearchTopicRecommendationPayload): string {
  switch (payload.recommendationKind) {
    case "add-to-prompt":
      return "Add to prompt";
    case "start-mission":
      return "Start mission";
    case "review-mission":
      return "Review mission";
    case "refine-mission":
    case "investigate-evidence-gap":
      return "Refine mission";
  }
}

function focusResearchDesk() {
  requestAnimationFrame(() => document.getElementById("research-desk-tab-desk")?.focus());
}

function didFocusEnterRecommendations(event: FocusEvent<HTMLElement>): boolean {
  return !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget));
}

async function revalidateResearchRecommendation(
  familiarId: string,
  recommendation: ResearchTopicRecommendation,
): Promise<ResearchTopicRecommendation> {
  const response = await fetch(
    `/api/research/recommendations?familiarId=${encodeURIComponent(familiarId)}&contextFingerprint=${encodeURIComponent(recommendation.contextFingerprint)}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );
  const body = (await response.json().catch(() => null)) as ResearchRecommendationsResponse | null;
  const current = body?.recommendations?.find((candidate) => candidate.id === recommendation.id);
  if (
    !response.ok
    || !body?.ok
    || !current
    || body.contextFingerprint !== recommendation.contextFingerprint
    || current.contextFingerprint !== recommendation.contextFingerprint
  ) {
    throw new Error("Recommendations changed. Refresh topics before applying an action.");
  }
  return current;
}

export function ResearchTabPrompt({ research, context, onNavigate, initialMode, initialDraft }: ResearchTabPromptProps) {
  const links = useResearchLinks();
  const { announce } = useAnnouncer();
  const [attached, setAttached] = useState<SavedLinkSummary[]>([]);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [recommendedDraft, setRecommendedDraft] = useState<{ value: string; revision: number } | null>(null);
  const [topicActionId, setTopicActionId] = useState<string | null>(null);
  const [topicActionError, setTopicActionError] = useState<string | null>(null);
  const [recommendationReducedContext, setRecommendationReducedContext] = useState(false);
  const serverRecommendationSnapshot = useRef<ResearchRecommendationSnapshot | null>(null);
  const revisionRequestRef = useRef<Promise<void> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Angle seeds are real titles only: recent, non-archived missions plus the
  // newest quick saves. No data → no chips (the composer hides the row).
  const angleSeeds = useMemo(() => {
    const missionTitles = research.missions
      .filter((mission) => mission.status !== "archived")
      .slice(0, ANGLE_SEEDS_PER_POOL)
      .map((mission) => mission.title);
    const linkTitles = links.links.slice(0, ANGLE_SEEDS_PER_POOL).map((link) => link.title);
    return [...missionTitles, ...linkTitles];
  }, [research.missions, links.links]);

  const recommendations = useMemo(
    () => promptRecommendations(research.missions),
    [research.missions],
  );

  const attachedChips: AttachedResearchLink[] = attached.map((link) => ({
    id: link.id,
    title: link.title,
    url: link.url,
  }));

  const toggleAttach = (link: SavedLinkSummary) => {
    setAttached((current) => (
      current.some((entry) => entry.id === link.id)
        ? current.filter((entry) => entry.id !== link.id)
        : [...current, link]
    ));
  };

  const trimmedQuery = query.trim().toLowerCase();
  const visibleLinks = trimmedQuery
    ? links.links.filter((link) => `${link.title} ${link.url}`.toLowerCase().includes(trimmedQuery))
    : links.links;

  const groups: QuickSaveGroup<SavedLinkSummary>[] = useMemo(
    () => matchSavedLinks(visibleLinks, draft),
    [visibleLinks, draft],
  );
  const allVisibleAttached = visibleLinks.length > 0
    && visibleLinks.every((link) => attached.some((entry) => entry.id === link.id));
  const visibleResultLabel = `${visibleLinks.length} ${visibleLinks.length === 1 ? "result" : "results"}`;
  const toggleVisibleLinks = () => {
    const action = allVisibleAttached ? "Cleared" : "Selected";
    setAttached((current) => updateVisibleQuickSaveSelection(links.links, current, visibleLinks));
    announce(`${action} ${visibleResultLabel}.`);
  };

  const onDraftChange = useCallback((next: string) => setDraft(next), []);

  const recommendationContext = useMemo<ResearchRecommendationClientContext>(
    () => buildResearchRecommendationContext(context.activeFamiliar.id, research.missions, links.links),
    [context.activeFamiliar.id, links.links, research.missions],
  );
  const recommendationContextKey = researchRecommendationContextKey(recommendationContext);
  const latestRecommendationContextKey = useRef(recommendationContextKey);
  latestRecommendationContextKey.current = recommendationContextKey;

  const agentic = useAgenticRecommendations<ResearchRecommendationClientContext>({
    context: recommendationContext,
    enabled: !research.loading && !links.loading,
    meaningfulContextKey: researchRecommendationContextKey,
    createRunId: () => `research-topics-${crypto.randomUUID()}`,
    parseOutput: parseResearchTopicRecommendations,
    generate: async ({ context: snapshot, contextFingerprint, signal }) => {
      const response = await fetch(
        `/api/research/recommendations?familiarId=${encodeURIComponent(snapshot.familiarId)}`,
        {
          method: "GET",
          cache: "no-store",
          signal,
        },
      );
      const body = (await response.json().catch(() => null)) as ResearchRecommendationsResponse | null;
      if (
        !response.ok
        || !body?.ok
        || !Array.isArray(body.recommendations)
        || typeof body.contextFingerprint !== "string"
      ) {
        throw new Error("Research topic recommendations could not be loaded.");
      }
      if (latestRecommendationContextKey.current === researchRecommendationContextKey(snapshot)) {
        setRecommendationReducedContext(body.reducedContext === true);
        serverRecommendationSnapshot.current = {
          clientContextKey: researchRecommendationContextKey(snapshot),
          serverContextFingerprint: body.contextFingerprint,
          recommendations: new Map(
            body.recommendations.map((recommendation) => [recommendation.id, recommendation]),
          ),
        };
      }
      const recommendations = body.recommendations.map((recommendation) => {
        const {
          ordinal: _ordinal,
          verification: _verification,
          application: _application,
          ...proposal
        } = recommendation;
        return {
          ...proposal,
          contextFingerprint,
        };
      });
      return JSON.stringify({ recommendations });
    },
    apply: async () => {
      throw new Error("Research topic recommendations require an explicit action.");
    },
  });
  const checkRecommendationRevision = useCallback(() => {
    if (revisionRequestRef.current) return revisionRequestRef.current;
    if (research.loading || links.loading) return Promise.resolve();
    const snapshot = serverRecommendationSnapshot.current;
    if (!snapshot || snapshot.clientContextKey !== recommendationContextKey) return Promise.resolve();

    const request = (async () => {
      try {
        const response = await fetch(
          `/api/research/recommendations?familiarId=${encodeURIComponent(context.activeFamiliar.id)}&revision=1`,
          { method: "GET", cache: "no-store" },
        );
        const body = (await response.json().catch(() => null)) as ResearchRecommendationsResponse | null;
        if (!response.ok || !body?.ok || typeof body.contextFingerprint !== "string") return;
        if (body.contextFingerprint !== snapshot.serverContextFingerprint) {
          agentic.refresh();
        }
      } catch {
        // Keep the last grounded cards; explicit action revalidation remains the
        // final guard if a foreground revision check cannot reach the Cave.
      }
    })();
    revisionRequestRef.current = request;
    void request.finally(() => {
      if (revisionRequestRef.current === request) {
        revisionRequestRef.current = null;
      }
    });
    return request;
  }, [
    agentic,
    context.activeFamiliar.id,
    links.loading,
    recommendationContextKey,
    research.loading,
  ]);

  useEffect(() => {
    const onForeground = () => {
      if (!document.hidden) void checkRecommendationRevision();
    };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [checkRecommendationRevision]);

  const recommendationItems = agentic.state.items
    .filter((item) => item.phase !== "dismissed")
    .flatMap((item) => {
      const snapshot = serverRecommendationSnapshot.current;
      const recommendation = snapshot?.clientContextKey === recommendationContextKey
        ? snapshot.recommendations.get(item.recommendation.id)
        : undefined;
      return recommendation ? [recommendation] : [];
    });
  const agenticCardState: AgenticRecommendationCardState = agentic.state.phase === "generating"
    || agentic.state.phase === "debouncing"
    ? "loading"
    : agentic.state.phase === "error"
      ? "error"
      : recommendationItems.length === 0
        ? "empty"
        : "ready";
  const reducedContext = recommendationReducedContext || recommendationItems.some(
    (item) => item.rankReasons.includes(REDUCED_CONTEXT_REASON),
  );

  const activateTopic = useCallback(async (recommendation: ResearchTopicRecommendation) => {
    const initialPayload = researchTopicPayload(recommendation);
    if (!initialPayload) return;
    const draftAtActivation = draftRef.current;
    setTopicActionId(recommendation.id);
    setTopicActionError(null);
    try {
      const current = await revalidateResearchRecommendation(context.activeFamiliar.id, recommendation);
      const payload = researchTopicPayload(current);
      if (!payload) {
        throw new Error("Recommendations changed. Refresh topics before applying an action.");
      }

      if (payload.recommendationKind === "add-to-prompt") {
        if (draftRef.current !== draftAtActivation) {
          throw new Error("Prompt changed while checking this topic. It remains a suggestion.");
        }
        if (draftRef.current.includes(payload.topic)) {
          announce(`"${payload.topic}" is already in the prompt.`);
          return;
        }
        const value = draftRef.current.trim()
          ? `${draftRef.current.trim()}\n\n${payload.topic}`
          : payload.topic;
        setRecommendedDraft((currentDraft) => ({
          value,
          revision: (currentDraft?.revision ?? 0) + 1,
        }));
        announce(`Added "${payload.topic}" to the prompt.`);
        return;
      }

      if (!payload.targetMissionId && payload.recommendationKind !== "start-mission") {
        throw new Error("This recommendation no longer points to a Research mission.");
      }

      if (payload.recommendationKind === "start-mission") {
        const result = await research.start(
          createResearchMissionInputFromIntent(context.activeFamiliar.id, payload.topic),
        );
        if (!result.ok) {
          throw new Error(result.error);
        }
        announce(`Started mission "${result.mission.title}".`);
        onNavigate("desk", { missionId: result.mission.id });
        focusResearchDesk();
        return;
      }

      if (payload.recommendationKind === "review-mission") {
        onNavigate("desk", { missionId: payload.targetMissionId });
        focusResearchDesk();
        announce(`Opened mission "${payload.topic}" for review.`);
        return;
      }

      const result = await research.act(payload.targetMissionId!, {
        action: "refine",
        direction: payload.topic,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      announce(`Refined mission "${result.mission.title}".`);
      onNavigate("desk", { missionId: result.mission.id });
      focusResearchDesk();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Recommendation could not be applied. Refresh topics and try again.";
      setTopicActionError(message);
      announce(message);
      if (message.startsWith("Recommendations changed.")) {
        agentic.refresh();
      }
    } finally {
      setTopicActionId(null);
    }
  }, [agentic, announce, context.activeFamiliar.id, onNavigate, research]);

  return (
    <div className="research-intake" data-drawer-open={drawerOpen}>
      <div className="research-intake__scroll">
        <div className="research-intake__column">
          <header className="research-intake__hero">
            <h2>Turn a question into durable knowledge.</h2>
            <p>Bounded research · checkpoints you review · findings you can export or act on.</p>
          </header>

          <ResearchMissionComposer
            familiarId={context.activeFamiliar.id}
            daemonRunning={context.runtimeState.daemonRunning}
            initialMode={initialMode}
            initialDraft={initialDraft}
            recommendedDraft={recommendedDraft}
            attachedLinks={attachedChips}
            onRemoveAttached={(id) => setAttached((current) => current.filter((entry) => entry.id !== id))}
            angleSeeds={angleSeeds}
            recommendations={recommendations}
            onDraftChange={onDraftChange}
            onOpenResources={() => onNavigate("resources")}
            onStart={async (input) => {
              const result = await research.start({
                ...input,
                savedLinkIds: attached.map((link) => link.id),
              });
              if (result.ok) {
                setAttached([]);
                onNavigate("desk", { missionId: result.mission.id });
              }
              return result;
            }}
          />

          <section
            className="research-topic-recommendations"
            aria-labelledby="research-topic-recommendations-heading"
            onFocusCapture={(event) => {
              if (didFocusEnterRecommendations(event)) {
                void checkRecommendationRevision();
              }
            }}
          >
              <header className="research-topic-recommendations__header">
                <div>
                  <p className="research-topic-recommendations__kicker">Contextual research</p>
                  <h3 id="research-topic-recommendations-heading">Suggested next topics</h3>
                  <p>Grounded in collective Coven sessions, current missions, saved sources, and relevant Vault evidence.</p>
                </div>
                <button
                  type="button"
                  className="research-topic-recommendations__refresh focus-ring"
                  onClick={() => {
                    agentic.refresh();
                    announce("Refreshing suggested next topics.");
                  }}
                >
                  Refresh topics
                </button>
              </header>

              {reducedContext ? (
                <p className="research-topic-recommendations__reduced" role="status">
                  Vault context is unavailable — using Research Desk evidence.
                </p>
              ) : null}
              {topicActionError ? (
                <p className="research-topic-recommendations__action-error" role="alert">{topicActionError}</p>
              ) : null}

              {agenticCardState === "empty" ? (
                <EmptyState
                  compact
                  headline="No grounded topics yet"
                  subtitle="Add a mission, saved source, or Vault entry, then refresh topics."
                />
              ) : agenticCardState !== "ready" ? (
                <AgenticRecommendationCard
                  state={agenticCardState}
                  errorMessage={agentic.state.error?.message}
                  onRetry={agentic.refresh}
                />
              ) : (
                <div className="research-topic-recommendations__cards">
                  {recommendationItems.map((recommendation) => {
                    const payload = researchTopicPayload(recommendation);
                    if (!payload) return null;
                    const rankedRecommendation: ResearchTopicRecommendation = {
                      ...recommendation,
                      ordinal: recommendationItems.indexOf(recommendation) + 1,
                    };
                    return (
                      <ResearchTopicDecisionCard
                        key={rankedRecommendation.id}
                        recommendation={rankedRecommendation}
                        actionLabel={topicActionLabel(payload)}
                        busy={topicActionId === rankedRecommendation.id}
                        onAction={() => void activateTopic({
                              ...recommendation,
                              ordinal: rankedRecommendation.ordinal,
                            })}
                      />
                    );
                  })}
                </div>
              )}
          </section>
        </div>
      </div>

      {drawerOpen ? (
        <section className="research-quick-saves__sheet" aria-label="Quick saves">
          <div className="research-quick-saves__head">
            <strong>Quick saves</strong>
            <span className="research-quick-saves__count">
              Selected resources are included before the first research pass starts.
            </span>
            {visibleLinks.length > 0 ? (
              <button
                type="button"
                className="research-quick-saves__all focus-ring"
                aria-pressed={allVisibleAttached}
                onClick={toggleVisibleLinks}
              >
                {allVisibleAttached
                  ? `Clear ${visibleResultLabel}`
                  : `Select all ${visibleResultLabel}`}
              </button>
            ) : null}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search saves…"
              aria-label="Search saves"
              className="research-quick-saves__search"
            />
            <button
              type="button"
              className="research-quick-saves__all focus-ring"
              onClick={() => onNavigate("resources")}
            >
              All in Resources →
            </button>
          </div>

          <div className="research-quick-saves__body">
            {links.error ? (
              <p className="research-mission-error" role="alert">{links.error}</p>
            ) : links.loading ? (
              <p className="research-quick-saves__empty">Loading saves…</p>
            ) : links.links.length === 0 ? (
              <p className="research-quick-saves__empty">
                No saves yet. Type <code>/save</code> in any chat to collect links.
              </p>
            ) : groups.length === 0 ? (
              <p className="research-quick-saves__empty">
                No saves match “{query}” —{" "}
                <button type="button" className="research-quick-saves__inline" onClick={() => onNavigate("resources")}>
                  search all Resources →
                </button>
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="research-quick-saves__group">
                  <div className="research-quick-saves__group-head" data-suggested={group.suggested}>
                    <span className="research-quick-saves__group-label">{group.label}</span>
                    <span className="research-quick-saves__group-count">{group.links.length}</span>
                    <span className="research-quick-saves__rule" aria-hidden />
                    {group.hint ? (
                      <span className="research-quick-saves__group-hint">{group.hint}</span>
                    ) : null}
                  </div>
                  <ul className="research-quick-saves__list">
                    {group.links.map((entry) => {
                      const isAttached = attached.some((item) => item.id === entry.link.id);
                      const meta = linkCategoryMeta(entry.link.category);
                      return (
                        <li key={entry.link.id}>
                          <button
                            type="button"
                            className="research-quick-saves__row focus-ring"
                            aria-pressed={isAttached}
                            title={entry.why ? `${meta.label} · suggested: ${entry.why}` : meta.label}
                            onClick={() => toggleAttach(entry.link)}
                          >
                            <span className="research-quick-saves__chip" data-category={entry.link.category}>
                              <Icon name={meta.icon} width={11} height={11} aria-hidden />
                            </span>
                            <span className="research-quick-saves__title">{entry.link.title}</span>
                            {entry.why ? (
                              <span className="research-quick-saves__why">{entry.why}</span>
                            ) : null}
                            <time dateTime={entry.link.addedAt}>
                              {relativeTime(entry.link.addedAt) || "just now"}
                            </time>
                            <span className="research-quick-saves__mark" data-attached={isAttached}>
                              {isAttached ? "✓ attached" : "+ attach"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <div className="research-quick-saves__bar">
        <button
          type="button"
          className="research-quick-saves__toggle focus-ring"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <Icon name="ph:link" width={13} height={13} aria-hidden />
          Quick saves
          <span className="research-quick-saves__pill">{links.links.length}</span>
          <span className="research-quick-saves__chev" data-open={drawerOpen} aria-hidden>▴</span>
        </button>
        {attached.length > 0 ? (
          <span className="research-quick-saves__attached">
            {attached.length} ready for the first pass
          </span>
        ) : null}
        <span className="research-quick-saves__origin">
          saved from chat sessions and the browser extension
        </span>
      </div>
    </div>
  );
}
