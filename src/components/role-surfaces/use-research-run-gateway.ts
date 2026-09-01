"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getResearchRunGateway,
  parseResearchRunGatewaySseFrame,
  researchRunGatewayStreamUrl,
  type ResearchRunGatewaySseFrame,
} from "@/lib/research-run-gateway-client";
import {
  consumeResearchRunEvent,
  createResearchRunEventState,
  rehydrateResearchRun,
  type ResearchRunEventState,
} from "@/lib/research-run-event-reducer";
import type { ResearchMission } from "@/lib/research-missions";
import type { ResearchRunV1 } from "@/lib/research-protocol/research-run";
import {
  hydrateHybridResearchRunProjectionInput,
  researchMissionMatchesRunSelector,
  researchMissionToRunProjectionInput,
  selectResearchRunProjections,
  type ResearchRunProjections,
} from "@/lib/research-run-projections";

export type ResearchRunGatewayViewState = {
  run: ResearchRunV1 | null;
  eventState: ResearchRunEventState | null;
  missionDetail: ResearchMission | null;
  status: "idle" | "loading" | "connected" | "reconnecting" | "error";
  error: string | null;
  historyComplete: boolean;
  projections: ResearchRunProjections | null;
  projectionSource: "canonical" | "legacy" | null;
  projectionError: string | null;
  missionDetailAvailable: boolean;
  retry(): void;
};

type ResearchRunCompleteView = {
  eventState: ResearchRunEventState;
  missionDetail: ResearchMission | null;
  projections: ResearchRunProjections | null;
  projectionSource: "canonical" | "legacy" | null;
  projectionError: string | null;
};

type ResearchRunGatewayTransportState = Pick<
  ResearchRunGatewayViewState,
  "run" | "eventState" | "status" | "error"
> & {
  selector: string | null;
  completeView: ResearchRunCompleteView | null;
};

const IDLE: ResearchRunGatewayTransportState = {
  selector: null,
  run: null,
  eventState: null,
  completeView: null,
  status: "idle",
  error: null,
};

function hasCompleteEventHistory(state: ResearchRunEventState | null): boolean {
  if (!state || state.sync.status !== "synced" || state.pendingEvents.length > 0) return false;
  const expectedLastSequence = state.run.nextEventSequence - 1;
  return state.lastEventSequence === expectedLastSequence
    && state.appliedEvents.length === expectedLastSequence
    && state.appliedEvents.every((event, index) =>
      event.runId === state.run.id && event.sequence === index + 1);
}

function missionDetailForRun(
  mission: ResearchMission | null | undefined,
  selector: string,
  runId: string,
): ResearchMission | null {
  return mission
    && researchMissionMatchesRunSelector(mission, selector)
    && researchMissionMatchesRunSelector(mission, runId)
    ? mission
    : null;
}

function missionLifecycleMatchesRun(
  mission: ResearchMission,
  run: ResearchRunV1,
): boolean {
  if (mission.status === "archived") {
    return ["completed", "failed", "cancelled", "expired"].includes(run.status);
  }
  if (run.status === "completed") return mission.status === "completed";
  if (run.status === "failed") return mission.status === "failed";
  if (run.status === "cancelled" || run.status === "expired") {
    return mission.status === "cancelled";
  }
  return !["completed", "failed", "cancelled"].includes(mission.status);
}

function createCompleteView(
  eventState: ResearchRunEventState,
  missionDetail: ResearchMission | null,
): ResearchRunCompleteView {
  try {
    const hydrated = hydrateHybridResearchRunProjectionInput(
      eventState.run,
      eventState.appliedEvents,
      missionDetail,
    );
    return {
      eventState,
      missionDetail,
      projections: selectResearchRunProjections(hydrated),
      projectionSource: "canonical",
      projectionError: null,
    };
  } catch {
    if (missionDetail) {
      return {
        eventState,
        missionDetail,
        projections: selectResearchRunProjections(
          researchMissionToRunProjectionInput(missionDetail),
        ),
        projectionSource: "legacy",
        projectionError: "Canonical Research Run history could not be projected",
      };
    }
    return {
      eventState,
      missionDetail: null,
      projections: null,
      projectionSource: null,
      projectionError: "Canonical Research Run history could not be projected",
    };
  }
}

function promoteCompleteView(
  previous: ResearchRunCompleteView | null,
  eventState: ResearchRunEventState,
  missionDetail: ResearchMission | null,
): ResearchRunCompleteView {
  if (
    previous?.eventState.run.id === eventState.run.id
    && previous.eventState.lastEventSequence >= eventState.lastEventSequence
  ) {
    return previous;
  }
  return createCompleteView(eventState, missionDetail);
}

export function useResearchRunGateway(
  missionOrRunId: string | null,
  familiarId: string,
  legacyMission?: ResearchMission | null,
): ResearchRunGatewayViewState {
  const [state, setState] = useState<ResearchRunGatewayTransportState>(IDLE);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const generation = useRef(0);
  const legacyMissionRef = useRef(legacyMission);
  legacyMissionRef.current = legacyMission;
  const retryPending = useRef(false);
  const retry = useCallback(() => {
    if (!missionOrRunId || retryPending.current) return;
    retryPending.current = true;
    setState((previous) => previous.selector === missionOrRunId
      ? { ...previous, status: "loading", error: null }
      : previous);
    setRetryGeneration((current) => current + 1);
  }, [missionOrRunId]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!missionOrRunId) {
      retryPending.current = false;
      setState(IDLE);
      return;
    }
    retryPending.current = true;
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

    const current = () => !stopped && generation.current === currentGeneration;
    const applyFrame = (
      frame: ResearchRunGatewaySseFrame,
      candidate: EventSource,
      boundRunId: string,
    ) => {
      if (!current() || source !== candidate) return;
      if (frame.kind === "error") {
        candidate.close();
        setState((previous) => ({ ...previous, status: "error", error: frame.message }));
        return;
      }
      if (frame.kind === "snapshot") {
        if (frame.run.id !== boundRunId) {
          candidate.close();
          setState({
            selector: missionOrRunId,
            run: frame.run,
            eventState: createResearchRunEventState(frame.run),
            completeView: null,
            status: "loading",
            error: null,
          });
          openSource(frame.run.id);
          return;
        }
        setState((previous) => {
          const eventState = rehydrateResearchRun(frame.run, [], {
            afterSequence: frame.afterSeq,
            previousState: previous.eventState ?? undefined,
          });
          const historyComplete = hasCompleteEventHistory(eventState);
          const completeView = historyComplete
            ? promoteCompleteView(
                previous.completeView,
                eventState,
                missionDetailForRun(legacyMissionRef.current, missionOrRunId, frame.run.id),
              )
            : previous.completeView?.eventState.run.id === frame.run.id
              ? previous.completeView
              : null;
          return {
            selector: missionOrRunId,
            run: frame.run,
            eventState,
            completeView,
            status: historyComplete
              ? "connected"
              : previous.status === "reconnecting" ? "reconnecting" : "loading",
            error: null,
          };
        });
        return;
      }
      setState((previous) => {
        if (!previous.eventState || previous.eventState.run.id !== frame.event.runId) {
          return { ...previous, status: "error", error: "Research Run event belongs to another run" };
        }
        const consumed = consumeResearchRunEvent(previous.eventState, frame.event);
        if (consumed.disposition === "rejected" || consumed.disposition === "conflict") {
          source?.close();
          return {
            ...previous,
            status: "error",
            error: "Research Run event stream requires a fresh snapshot",
          };
        }
        const historyComplete = hasCompleteEventHistory(consumed.state);
        return {
          ...previous,
          run: consumed.state.run,
          eventState: consumed.state,
          completeView: historyComplete
            ? promoteCompleteView(
                previous.completeView,
                consumed.state,
                missionDetailForRun(
                  legacyMissionRef.current,
                  missionOrRunId,
                  consumed.state.run.id,
                ),
              )
            : previous.completeView?.eventState.run.id === consumed.state.run.id
              ? previous.completeView
              : null,
          status: consumed.state.sync.status === "gap"
            ? "reconnecting"
            : historyComplete
              ? "connected"
              : previous.status === "reconnecting" ? "reconnecting" : "loading",
          error: consumed.state.sync.status === "gap"
            ? "Research Run event stream has a gap; reconnecting"
            : null,
        };
      });
    };

    const openSource = (boundRunId: string) => {
      source?.close();
      const candidate = new EventSource(
        researchRunGatewayStreamUrl(missionOrRunId, familiarId, 0, boundRunId),
      );
      source = candidate;
      candidate.onopen = () => {
        if (current() && source === candidate) {
          setState((previous) => ({
            ...previous,
            status: hasCompleteEventHistory(previous.eventState)
              ? "connected"
              : previous.status === "reconnecting" ? "reconnecting" : "loading",
            error: null,
          }));
        }
      };
      candidate.addEventListener("snapshot", (event) => {
        const frame = parseResearchRunGatewaySseFrame("snapshot", (event as MessageEvent<string>).data);
        if (frame) applyFrame(frame, candidate, boundRunId);
      });
      candidate.addEventListener("run-event", (event) => {
        const frame = parseResearchRunGatewaySseFrame("run-event", (event as MessageEvent<string>).data);
        if (frame) applyFrame(frame, candidate, boundRunId);
      });
      candidate.onerror = () => {
        if (current() && source === candidate) {
          setState((previous) => ({ ...previous, status: "reconnecting" }));
        }
      };
    };

    const connect = async () => {
      setState((previous) => previous.selector === missionOrRunId
        ? { ...previous, status: "loading", error: null }
        : {
          selector: missionOrRunId,
          run: null,
          eventState: null,
          completeView: null,
          status: "loading",
          error: null,
        });
      const snapshot = await getResearchRunGateway(missionOrRunId, familiarId, controller.signal);
      if (!current()) return;
      retryPending.current = false;
      if (!snapshot.ok) {
        setState((previous) => previous.selector === missionOrRunId && previous.completeView
          ? {
              ...previous,
              status: "error",
              error: snapshot.error ?? "Research Run could not be loaded",
            }
          : {
              selector: missionOrRunId,
              run: null,
              eventState: null,
              completeView: null,
              status: "error",
              error: snapshot.error ?? "Research Run could not be loaded",
            });
        return;
      }
      setState((previous) => {
        const eventState = createResearchRunEventState(snapshot.run);
        return {
          selector: missionOrRunId,
          run: snapshot.run,
          eventState,
          completeView: previous.completeView?.eventState.run.id === snapshot.run.id
            ? previous.completeView
            : null,
          status: "loading",
          error: null,
        };
      });
      openSource(snapshot.run.id);
    };

    void connect().catch((error) => {
      if (current() && (error as Error).name !== "AbortError") {
        retryPending.current = false;
        setState((previous) => previous.selector === missionOrRunId && previous.completeView
          ? {
              ...previous,
              status: "error",
              error: "Research Run gateway could not be loaded",
            }
          : {
              selector: missionOrRunId,
              run: null,
              eventState: null,
              completeView: null,
              status: "error",
              error: "Research Run gateway could not be loaded",
            });
      }
    });
    return () => {
      stopped = true;
      controller.abort();
      source?.close();
    };
  }, [familiarId, missionOrRunId, retryGeneration]);

  const currentState = state.selector === missionOrRunId
    ? state
    : {
      selector: missionOrRunId,
      run: null,
      eventState: null,
      completeView: null,
      status: missionOrRunId ? "loading" as const : "idle" as const,
      error: null,
    };
  const liveMissionDetailAvailable = Boolean(
    missionOrRunId
    && legacyMission
    && researchMissionMatchesRunSelector(legacyMission, missionOrRunId)
    && (
      !currentState.run
      || researchMissionMatchesRunSelector(legacyMission, currentState.run.id)
    ),
  );
  const projectionMission = liveMissionDetailAvailable ? legacyMission ?? null : null;
  const storedCompleteView = currentState.completeView?.eventState.run.id === currentState.eventState?.run.id
    ? currentState.completeView
    : null;
  const completeView = useMemo(() => {
    if (!storedCompleteView || !missionOrRunId) return storedCompleteView;
    const matchingMission = missionDetailForRun(
      legacyMission,
      missionOrRunId,
      storedCompleteView.eventState.run.id,
    );
    if (legacyMission && !matchingMission) {
      return createCompleteView(storedCompleteView.eventState, null);
    }
    if (
      matchingMission
      && currentState.status === "connected"
      && hasCompleteEventHistory(currentState.eventState)
      && missionLifecycleMatchesRun(matchingMission, currentState.eventState!.run)
    ) {
      return createCompleteView(currentState.eventState!, matchingMission);
    }
    return storedCompleteView;
  }, [
    currentState.eventState,
    currentState.status,
    legacyMission,
    missionOrRunId,
    storedCompleteView,
  ]);
  const historyComplete = Boolean(completeView);
  const projection = useMemo(() => {
    if (completeView) {
      return {
        projections: completeView.projections,
        projectionSource: completeView.projectionSource,
        projectionError: completeView.projectionError,
      };
    }
    if (projectionMission) {
      return {
        projections: selectResearchRunProjections(
          researchMissionToRunProjectionInput(projectionMission),
        ),
        projectionSource: "legacy" as const,
        projectionError: null,
      };
    }
    return {
      projections: null,
      projectionSource: null,
      projectionError: null,
    };
  }, [completeView, projectionMission]);
  const missionDetail = completeView
    ? completeView.missionDetail
    : projectionMission;
  const missionDetailAvailable = completeView
    ? Boolean(completeView.missionDetail)
    : liveMissionDetailAvailable;

  return {
    run: completeView?.eventState.run ?? null,
    eventState: completeView?.eventState ?? null,
    missionDetail,
    status: currentState.status,
    error: currentState.error,
    historyComplete,
    missionDetailAvailable,
    retry,
    ...projection,
  };
}
